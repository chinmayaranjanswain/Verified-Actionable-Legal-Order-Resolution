# ═══════════════════════════════════════════════════════════════════
# V.A.L.O.R. — Local Ollama LLM Refinement Engine
# Same API as Colab engine, but uses your LOCAL Ollama model
# No GPU rental needed. Runs on your own machine.
# ═══════════════════════════════════════════════════════════════════

"""
SETUP:
  1. Install Ollama: https://ollama.com/download
  2. Pull a model:
       ollama pull llama3.2        (3B, fast, ~2GB RAM)
       ollama pull mistral         (7B, balanced, ~4GB RAM)
       ollama pull phi3            (3.8B, good for extraction)
       ollama pull gemma2:9b       (9B, best quality, ~6GB RAM)
  3. Install Python deps:
       pip install flask flask-cors requests
  4. Run this script:
       python VALOR_Local_Ollama.py
  5. Paste URL into V.A.L.O.R. Settings:
       Local:  http://localhost:5000
       Ngrok:  (printed in terminal if --ngrok flag used)

USAGE:
  python VALOR_Local_Ollama.py                    # localhost only
  python VALOR_Local_Ollama.py --ngrok            # expose via ngrok
  python VALOR_Local_Ollama.py --model mistral    # use specific model
  python VALOR_Local_Ollama.py --port 5001        # custom port
"""

import json
import re
import sys
import argparse
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Config ────────────────────────────────────────────────────────
OLLAMA_BASE = "http://localhost:11434"
DEFAULT_MODEL = "llama3.2"

# ── Parse CLI args ────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="V.A.L.O.R. Local Ollama Engine")
parser.add_argument("--model", default=DEFAULT_MODEL, help="Ollama model name (default: llama3.2)")
parser.add_argument("--port", type=int, default=5000, help="Server port (default: 5000)")
parser.add_argument("--ngrok", action="store_true", help="Expose via ngrok tunnel")
parser.add_argument("--ollama-url", default=OLLAMA_BASE, help="Ollama API base URL (default: http://localhost:11434)")
args = parser.parse_args()

MODEL_NAME = args.model
PORT = args.port
OLLAMA_BASE = args.ollama_url

# ── Verify Ollama is running ──────────────────────────────────────
def check_ollama():
    try:
        r = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
        if r.status_code == 200:
            models = [m["name"] for m in r.json().get("models", [])]
            print(f"[VALOR] Ollama running. Available models: {models}")
            if not any(MODEL_NAME in m for m in models):
                print(f"[VALOR] WARNING: Model '{MODEL_NAME}' not found locally.")
                print(f"[VALOR] Run: ollama pull {MODEL_NAME}")
                return False
            return True
        return False
    except Exception as e:
        print(f"[VALOR] ERROR: Cannot reach Ollama at {OLLAMA_BASE}")
        print(f"[VALOR] Make sure Ollama is running: ollama serve")
        print(f"[VALOR] Error: {e}")
        return False

# ── Prompt (same as Colab engine) ─────────────────────────────────
def build_prompt(text):
    return f"""You are a legal data extraction assistant for Indian court judgments.
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

Extract from this court judgment:

{text[:3500]}"""

# ── LLM Call via Ollama API ───────────────────────────────────────
def run_llm(text):
    prompt = build_prompt(text)

    response = requests.post(
        f"{OLLAMA_BASE}/api/generate",
        json={
            "model": MODEL_NAME,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.1,
                "top_p": 0.9,
                "num_predict": 800,
                "repeat_penalty": 1.15,
            }
        },
        timeout=120
    )

    if response.status_code != 200:
        raise Exception(f"Ollama error: {response.status_code} — {response.text}")

    return response.json().get("response", "")

# ── JSON Extractor (same as Colab) ────────────────────────────────
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

# ── Flask API (same endpoints as Colab) ───────────────────────────
app = Flask(__name__)
CORS(app)

@app.route('/health', methods=['GET'])
def health():
    # Check Ollama is still alive
    try:
        r = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
    except:
        ollama_ok = False

    return jsonify({
        "status": "ok" if ollama_ok else "degraded",
        "model": MODEL_NAME,
        "gpu": "Local (Ollama)",
        "version": "2.0.0-local",
        "role": "refinement-only",
        "backend": "ollama",
        "ollama_status": "running" if ollama_ok else "unreachable"
    })

@app.route('/process', methods=['POST'])
def process():
    try:
        data = request.json
        text = data.get('text', '')

        if not text or len(text.strip()) < 50:
            return jsonify({"error": "Text too short", "result": None, "confidence": 0.0}), 400

        print(f"[VALOR] Processing {len(text)} chars via Ollama ({MODEL_NAME})...")

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
    if not check_ollama():
        print("\n[VALOR] Fix Ollama issues above, then retry.")
        sys.exit(1)

    public_url = f"http://localhost:{PORT}"

    if args.ngrok:
        try:
            from pyngrok import ngrok
            ngrok.kill()
            tunnel = ngrok.connect(PORT)
            public_url = str(tunnel)
            print(f"\n[VALOR] ngrok tunnel: {public_url}")
        except ImportError:
            print("[VALOR] ngrok requested but pyngrok not installed.")
            print("[VALOR] Run: pip install pyngrok")
            print("[VALOR] Falling back to localhost.\n")
        except Exception as e:
            print(f"[VALOR] ngrok failed: {e}")
            print("[VALOR] Falling back to localhost.\n")

    print("\n" + "=" * 60)
    print("  V.A.L.O.R. LOCAL REFINEMENT ENGINE (Ollama)")
    print(f"  URL:   {public_url}")
    print(f"  Model: {MODEL_NAME}")
    print(f"  Port:  {PORT}")
    print("  Paste URL into V.A.L.O.R. Settings page")
    print("=" * 60 + "\n")

    app.run(host="0.0.0.0", port=PORT, use_reloader=False)

if __name__ == "__main__":
    start_server()
