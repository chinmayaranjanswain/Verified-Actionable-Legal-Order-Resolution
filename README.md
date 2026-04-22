<p align="center">
  <img src="public/valor icon.png" alt="V.A.L.O.R. Logo" width="180" />
</p>

<h1 align="center">V.A.L.O.R.</h1>
<h3 align="center">Verified Actionable Legal Order Resolution</h3>

<p align="center">
  <strong>AI-powered decision-support system that converts court judgment PDFs into structured, actionable compliance plans for government departments.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/AI-Local%20LLM-E63225?style=flat-square&logo=ai&logoColor=white" />
  <img src="https://img.shields.io/badge/Stack-Vite%20+%20Vanilla%20JS-FFD60A?style=flat-square&logo=vite&logoColor=black" />
  <img src="https://img.shields.io/badge/PDF-Client--Side%20Processing-2547F5?style=flat-square&logo=adobeacrobatreader&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-1A8754?style=flat-square" />
</p>

---

## The Problem

Government systems like CCMS (Court Case Monitoring System) provide access to court judgments, but:

- Judgments are **long, unstructured PDF documents**
- No clear extraction of **actionable directives**
- Officials must **manually interpret** complex legal language
- This leads to **missed deadlines**, **delayed compliance**, and **contempt risks**

## The Solution

V.A.L.O.R. automates the entire pipeline:

```
PDF Upload → Text Extraction → AI Analysis → Structured Output → Human Verification → Compliance Dashboard
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      V.A.L.O.R. Client                      │
├────────────┬────────────┬──────────────┬────────────────────┤
│  PDF.js    │ Tesseract  │  Local LLM   │   Verification     │
│  Loader    │   OCR      │  (Gemma)     │      UI            │
├────────────┴────────────┴──────────────┴────────────────────┤
│                    Vite Dev Server                           │
├─────────────────────────────────────────────────────────────┤
│                    localStorage                             │
└─────────────────────────────────────────────────────────────┘
```

### Core Modules

| Module | Technology | Purpose |
|--------|-----------|---------|
| **PDF Loader** | PDF.js | Extract text from digital PDFs |
| **OCR Engine** | Tesseract.js | Handle scanned/image-based PDFs |
| **AI Analysis** | Local LLM (Gemma) | Entity extraction, directive detection, action plan generation |
| **Validator** | Custom schema | Enforce structured JSON output, validate AI responses |
| **Verification UI** | Vanilla JS | Human-in-the-loop editing, approval, rejection |
| **Dashboard** | Vanilla JS | Case tracking, compliance monitoring, data export |

---

## AI / LLM Strategy

> **V.A.L.O.R. uses a locally-hosted LLM** for production analysis — no data leaves the government network.

### Current Implementation

- **Model**: Google Gemma (via local inference / Gemini API fallback)
- **Tasks performed**:
  - Case entity extraction (case number, court, parties, judge)
  - Directive detection and classification (mandatory, advisory, conditional)
  - Timeline and deadline extraction
  - Action plan generation with department assignment
  - Confidence scoring per field
- **Fallback**: Demo mode with simulated data when API key is absent

### Planned Upgrades

- [ ] **Ollama integration** — Run Gemma/Mistral/LLaMA locally via Ollama API
- [ ] **Fine-tuned legal model** — Train on Indian court judgment corpus for higher accuracy
- [ ] **Multi-model ensemble** — Use multiple models and consensus scoring for critical fields
- [ ] **RAG pipeline** — Retrieve similar past judgments for context-aware analysis

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JS, HTML5, CSS3 |
| **Build** | Vite 6 |
| **PDF Processing** | PDF.js (CDN) |
| **OCR** | Tesseract.js (CDN) |
| **AI** | Gemma / Gemini API |
| **Storage** | localStorage (client-side) |
| **Icons** | Lucide Icons (inline SVG) |
| **Fonts** | Space Grotesk, Instrument Serif, JetBrains Mono |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/chinmayaranjanswain/Verified-Actionable-Legal-Order-Resolution.git
cd Verified-Actionable-Legal-Order-Resolution

# Install dependencies
npm install

# Configure environment (optional — enables live AI analysis)
cp .env.example .env
# Add your VITE_GEMINI_API_KEY to .env

# Start development server
npm run dev
```

The app opens at `http://localhost:5173/`

### Demo Mode

If no API key is configured, V.A.L.O.R. runs in **demo mode** with simulated analysis data — the full UI/UX remains testable.

---

## Roadmap — Features to Add

### Phase 1: Backend & Persistence
- [ ] **Express.js / Fastify API server** — Move from client-only to client-server architecture
- [ ] **PostgreSQL / SQLite database** — Replace localStorage with persistent, queryable storage
- [ ] **User authentication** — Role-based access (Admin, Verifier, Viewer)
- [ ] **File storage** — S3-compatible object storage for uploaded PDFs

### Phase 2: Microservices Architecture
- [ ] **PDF Processing Service** — Dedicated microservice for PDF text extraction + OCR
- [ ] **AI Analysis Service** — Isolated LLM inference service with queue management
- [ ] **Notification Service** — Email/SMS alerts for approaching deadlines
- [ ] **Audit Log Service** — Immutable record of all verification actions
- [ ] **API Gateway** — Rate limiting, auth middleware, request routing

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│  Client  │───▶│  API Gateway │───▶│   Auth Svc   │
│  (SPA)   │    │  (Nginx/     │    └──────────────┘
└──────────┘    │   Traefik)   │    ┌──────────────┐
                │              │───▶│  PDF Process  │
                │              │    │   Service     │
                │              │    └──────────────┘
                │              │    ┌──────────────┐
                │              │───▶│  AI Analysis  │
                │              │    │  Service(LLM) │
                │              │    └──────────────┘
                │              │    ┌──────────────┐
                │              │───▶│ Notification  │
                │              │    │   Service     │
                │              │    └──────────────┘
                └──────────────┘    ┌──────────────┐
                                    │  Audit Log    │
                                    │   Service     │
                                    └──────────────┘
```

### Phase 3: Intelligence & Compliance
- [ ] **Deadline tracker** — Automated countdown with escalation alerts
- [ ] **Department routing** — Auto-assign cases to relevant departments
- [ ] **Compliance scoring** — Track department response rates and overdue metrics
- [ ] **Historical analysis** — Compare with past judgments for precedent matching
- [ ] **Batch processing** — Upload multiple PDFs for bulk analysis

### Phase 4: Integration & Scale
- [ ] **CCMS API integration** — Direct pull from Court Case Monitoring System
- [ ] **Government SSO** — Integration with eSign/DigiLocker authentication
- [ ] **PDF annotation** — Highlight source text in original PDF alongside extracted data
- [ ] **Multi-language support** — Hindi, Odia, and other regional language judgments
- [ ] **Mobile PWA** — Responsive mobile interface for field officers
- [ ] **Docker Compose** — One-command deployment of full microservice stack
- [ ] **Kubernetes manifests** — Production-grade orchestration for scaling

### Phase 5: Advanced AI
- [ ] **Citation graph** — Build a knowledge graph of referenced cases and statutes
- [ ] **Summarization mode** — Generate executive summaries for senior officials
- [ ] **Risk assessment** — Flag high-risk contempt scenarios with probability scores
- [ ] **Voice interface** — Audio dictation for verification notes

---

## Project Structure

```
Verified-Actionable-Legal-Order-Resolution/
├── public/
│   ├── favicon.svg
│   └── valor-icon.png
├── src/
│   ├── main.js              # App entry — routing, pipeline, UI rendering
│   ├── modules/
│   │   ├── aiEngine.js       # LLM integration (Gemma/Gemini + demo fallback)
│   │   ├── ocrEngine.js      # Tesseract.js OCR for scanned PDFs
│   │   ├── pdfProcessor.js   # PDF.js text extraction
│   │   ├── storage.js        # localStorage CRUD operations
│   │   └── validator.js      # Schema validation for AI output
│   ├── styles/
│   │   ├── index.css         # Design system tokens + global resets
│   │   ├── components.css    # Shared component styles
│   │   ├── upload.css        # Upload page + pipeline styles
│   │   ├── results.css       # Results / verification view
│   │   └── dashboard.css     # Dashboard + data table
│   └── utils/
│       ├── helpers.js        # Formatters, toast system, SVG icon library
│       └── prompts.js        # LLM prompt engineering
├── index.html
├── package.json
├── vite.config.js
├── prd.md                    # Product requirements document
└── .env                      # API keys (not committed)
```

---

## Design Philosophy

V.A.L.O.R. uses a **Paper Brutalist** design language:

- **Sharp edges** — No rounded corners. Every element has hard borders
- **Offset shadows** — Bold black drop shadows that give depth like stacked paper
- **Warm palette** — Cream/ivory paper backgrounds with ruled notebook lines
- **Primary color accents** — Red (alerts), Yellow (active/pending), Blue (links/info), Green (approved)
- **Bold typography** — Space Grotesk uppercase headings, professional document feel
- **No emojis** — Clean, government-grade professional aesthetic

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License.

---

<p align="center">
  <strong>V.A.L.O.R.</strong> — Because justice delayed is justice denied.
</p>
