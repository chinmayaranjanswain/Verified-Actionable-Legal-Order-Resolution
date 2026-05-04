# ═══════════════════════════════════════════════════════════════════
# V.A.L.O.R. — Colab LLM Refinement Engine (OPTIONAL)
# The frontend works WITHOUT this. This only refines rule-based output.
# Copy-paste this ENTIRE file into a Google Colab notebook cell and run
# ═══════════════════════════════════════════════════════════════════

# ── CELL 1: Install Dependencies ──────────────────────────────────
# !pip install -q transformers flask flask-cors pyngrok torch

"""
INSTRUCTIONS:
1. Open Google Colab: https://colab.research.google.com
2. Select: Runtime → Change runtime type → T4 GPU
3. Create Cell 1 — paste the pip install line above (uncomment it)
4. Create Cell 2 — paste everything below
5. Run both cells
6. Copy the ngrok URL printed at the bottom
7. Paste it into V.A.L.O.R. Settings page

NOTE: V.A.L.O.R. works WITHOUT this Colab engine.
The rule-based engine handles extraction locally.
This LLM only REFINES results — fills gaps, improves phrasing.
"""

# ── CELL 2: Full Engine ───────────────────────────────────────────

import torch
import json
import re
from transformers import AutoTokenizer, AutoModelForCausalLM
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Model Setup ───────────────────────────────────────────────────
MODEL_NAME = "microsoft/phi-3-mini-4k-instruct"

print("[VALOR] Loading tokenizer...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)

# ── Patch rope_scaling config (transformers compat fix) ───────────
# Phi-3's custom modeling code only handles "longrope" scaling.
# Newer transformers adds rope_scaling with rope_type="default",
# which Phi-3 doesn't recognize. Disable it unless it's "longrope".
from transformers import AutoConfig
_cfg = AutoConfig.from_pretrained(MODEL_NAME, trust_remote_code=True)
if hasattr(_cfg, "rope_scaling") and _cfg.rope_scaling is not None:
    rope_type = _cfg.rope_scaling.get("type") or _cfg.rope_scaling.get("rope_type")
    if rope_type == "longrope":
        _cfg.rope_scaling.setdefault("type", rope_type)
        print(f"[VALOR] rope_scaling: longrope (kept)")
    else:
        _cfg.rope_scaling = None
        print(f"[VALOR] rope_scaling was '{rope_type}' — disabled (not needed)")

print("[VALOR] Loading model in float16 (T4 GPU — 16GB VRAM, model uses ~7.6GB)...")
model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    config=_cfg,
    device_map="auto",
    trust_remote_code=True,
    dtype=torch.float16,
    attn_implementation="eager",
)
model.eval()
print("[VALOR] Model loaded!")

# ── Prompt (Refinement-focused) ───────────────────────────────────
def build_prompt(text):
    return f"""<|system|>
You are a legal data extraction assistant for Indian court judgments.
Extract structured data from the ORDER section. Be precise. No hallucination.

RULES:
- Extract ONLY what is explicitly stated in the text
- If a field is missing, write "Not Found"
- For key_directions: extract sentences with "shall", "must", "directed to", "ordered to"
- For deadlines: extract timeframes like "30 days", "within 3 months"
- Return ONLY valid JSON — no markdown, no explanations

JSON STRUCTURE:
{{
  "case_no": "",
  "court": "",
  "date_of_order": "",
  "judge": "",
  "parties": "",
  "key_directions": [],
  "decision": "",
  "action_required": "",
  "department_responsible": "",
  "deadlines": [],
  "financial_implication": "",
  "risk_if_not_complied": ""
}}
<|end|>
<|user|>
Extract from this court judgment:

{text[:3500]}
<|end|>
<|assistant|>
"""

# ── LLM Inference ─────────────────────────────────────────────────
def run_llm(text):
    prompt = build_prompt(text)
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=3800).to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=800,
            temperature=0.1,
            top_p=0.9,
            do_sample=True,
            repetition_penalty=1.15,
            pad_token_id=tokenizer.eos_token_id,
        )

    new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True)

# ── JSON Extractor ────────────────────────────────────────────────
def extract_json(raw_text):
    text = raw_text.strip()
    text = re.sub(r'^```(?:json)?\s*\n?', '', text)
    text = re.sub(r'\n?```\s*$', '', text)

    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1:
        return None

    json_str = text[start:end + 1]

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    # Fix common LLM JSON issues
    fixed = json_str
    fixed = re.sub(r',\s*}', '}', fixed)
    fixed = re.sub(r',\s*]', ']', fixed)
    fixed = fixed.replace("'", '"')

    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        return None

# ── Confidence ────────────────────────────────────────────────────
def compute_confidence(data):
    if not data or not isinstance(data, dict):
        return 0.0

    fields = [
        "case_no", "court", "date_of_order", "judge", "parties",
        "decision", "action_required", "department_responsible",
        "financial_implication", "risk_if_not_complied"
    ]

    filled = 0
    for f in fields:
        val = data.get(f, "")
        if val and str(val).strip() and str(val).strip().lower() != "not found":
            filled += 1

    if data.get("key_directions") and len(data["key_directions"]) > 0:
        filled += 1
    if data.get("deadlines") and len(data["deadlines"]) > 0:
        filled += 1

    total = len(fields) + 2
    return round(filled / total, 2)

# ── Flask API ─────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "model": MODEL_NAME,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "version": "2.0.0",
        "role": "refinement-only"
    })

@app.route('/process', methods=['POST'])
def process():
    try:
        data = request.json
        text = data.get('text', '')

        if not text or len(text.strip()) < 50:
            return jsonify({"error": "Text too short", "result": None, "confidence": 0.0}), 400

        print(f"[VALOR] Processing {len(text)} chars for refinement...")

        raw_output = run_llm(text)
        print(f"[VALOR] LLM output: {raw_output[:200]}...")

        parsed = extract_json(raw_output)

        if parsed is None:
            return jsonify({
                "error": "JSON parse failed",
                "raw_output": raw_output,
                "result": None,
                "confidence": 0.0
            }), 200

        confidence = compute_confidence(parsed)
        print(f"[VALOR] Confidence: {confidence * 100}%")

        return jsonify({
            "result": parsed,
            "confidence": confidence,
            "raw_output": raw_output,
            "error": None
        })

    except Exception as e:
        print(f"[VALOR] Error: {str(e)}")
        return jsonify({"error": str(e), "result": None, "confidence": 0.0}), 500

# ── Start ─────────────────────────────────────────────────────────
def start_server():
    import os

    # ── Try ngrok (needs free authtoken) ──────────────────────────
    # Get your free token at: https://dashboard.ngrok.com/get-started/your-authtoken
    ngrok_token = os.environ.get("NGROK_TOKEN", "").strip()

    if not ngrok_token:
        print("\n" + "=" * 60)
        print("  NGROK AUTHTOKEN REQUIRED (free)")
        print("  1. Sign up: https://dashboard.ngrok.com/signup")
        print("  2. Copy token: https://dashboard.ngrok.com/get-started/your-authtoken")
        print("  3. Paste below:")
        print("=" * 60)
        ngrok_token = input("  Paste your ngrok authtoken: ").strip()

    if ngrok_token:
        try:
            from pyngrok import conf, ngrok
            conf.get_default().auth_token = ngrok_token
            ngrok.kill()
            public_url = ngrok.connect(5000)
            url = str(public_url).replace("NgrokTunnel: ", "").split(" ->")[0].strip('" ')
            print("\n" + "=" * 60)
            print("  V.A.L.O.R. REFINEMENT ENGINE (OPTIONAL)")
            print(f"  URL: {url}")
            print("  Paste this URL into V.A.L.O.R. Settings page")
            print("  NOTE: System works WITHOUT this — rules handle extraction")
            print("=" * 60 + "\n")
            app.run(port=5000, use_reloader=False)
            return
        except Exception as e:
            print(f"[VALOR] ngrok failed: {e}")
            print("[VALOR] Falling back to localtunnel...\n")

    # ── Fallback: localtunnel (no signup needed) ──────────────────
    import subprocess, threading
    def run_tunnel():
        proc = subprocess.Popen(
            ["npx", "-y", "localtunnel", "--port", "5000"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        for line in proc.stdout:
            if "url" in line.lower() or "https://" in line:
                print("\n" + "=" * 60)
                print("  V.A.L.O.R. REFINEMENT ENGINE (OPTIONAL)")
                print(f"  {line.strip()}")
                print("  Paste this URL into V.A.L.O.R. Settings page")
                print("=" * 60 + "\n")
            else:
                print(f"  [tunnel] {line.strip()}")

    threading.Thread(target=run_tunnel, daemon=True).start()
    app.run(port=5000, use_reloader=False)

start_server()