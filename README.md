# cf_ai_assistant — Memo

> An AI-powered personal assistant with persistent memory, built entirely on Cloudflare.

**Live demo**: Deploy your own in under 5 minutes (see below).

---

## What is Memo?

Memo is a conversational AI assistant that **remembers you**. Unlike a standard chatbot that forgets everything when you close the tab, Memo stores your entire conversation history in a Cloudflare Durable Object and persists it across sessions. When conversations grow long, a Cloudflare Workflow automatically summarises older messages so Memo always has the relevant context — without overflowing the model's context window.

---

## Architecture

```
Browser (Chat UI)
      │
      ▼
Cloudflare Worker (src/index.ts)         ← Router + session management
      │
      ├── Cloudflare Assets               ← Serves public/index.html
      │
      ├── Durable Object: ChatAgent       ← Per-user memory + AI inference
      │       │
      │       └── Workers AI (Llama 3.3) ← LLM inference
      │
      └── Workflow: SummarizeWorkflow     ← Async conversation compressor
              │
              └── Workers AI (Llama 3.3) ← LLM used to generate summaries
```

### Required Components (all four ticked ✅)

| Requirement | Implementation |
|---|---|
| **LLM** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI binding |
| **Workflow / coordination** | `SummarizeWorkflow` (Cloudflare Workflows) triggers async summarisation when messages exceed 30 |
| **User input via chat** | Full-featured chat UI in `public/index.html` served via Cloudflare Assets |
| **Memory / state** | `ChatAgent` Durable Object stores messages + summary in DO Storage (SQL-backed KV) |

---

## How It Works

1. **User sends a message** → Worker routes it to their personal `ChatAgent` Durable Object (keyed by session cookie).
2. **ChatAgent calls Llama 3.3** on Workers AI with the full conversation history (up to last 20 messages) plus any earlier summary as system context.
3. **Response streams back** to the browser and is persisted in Durable Object Storage.
4. **When > 30 messages accumulate**, the `SummarizeWorkflow` is triggered asynchronously. It uses the LLM to compress older messages into a concise summary, then writes it back to the Durable Object so future calls stay within the context window.
5. **On next page load**, history is fetched from the Durable Object — full continuity across browser sessions.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- A Cloudflare account (free tier works)
- Wrangler CLI: `npm install -g wrangler`

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/cf_ai_assistant.git
cd cf_ai_assistant
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser. The local dev server uses a simulated Durable Object and Workers AI (requires Cloudflare login for AI binding).

> **Note**: Workers AI and Durable Objects require a Cloudflare account even in local dev. Free tier is sufficient.

### 4. Deploy to Cloudflare

```bash
npm run deploy
```

Wrangler will:
- Bundle and upload the Worker
- Create the Durable Object namespace
- Register the Workflow
- Serve the frontend via Cloudflare Assets

Your app will be live at `https://cf-ai-assistant.<your-subdomain>.workers.dev`.

---

## Project Structure

```
cf_ai_assistant/
├── src/
│   ├── index.ts               # Worker router — handles routing & session cookies
│   ├── chatAgent.ts           # Durable Object — memory, chat handling, AI calls
│   ├── summarizeWorkflow.ts   # Workflow — async conversation summarisation
│   └── types.ts               # Shared TypeScript interfaces
├── public/
│   └── index.html             # Chat UI (vanilla HTML/CSS/JS, no build step)
├── wrangler.toml              # Cloudflare Workers configuration
├── package.json
├── tsconfig.json
├── README.md                  # ← You are here
└── PROMPTS.md                 # AI prompts used during development
```

---

## API Endpoints

All endpoints are proxied through `/api/*` by the main Worker.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | Send a message; body: `{ "message": "..." }` |
| `GET` | `/api/history` | Retrieve full conversation history |
| `POST` | `/api/clear` | Clear conversation and reset memory |
| `POST` | `/api/apply-summary` | (Internal) Used by the Workflow to update the summary |

---

## Configuration

Edit `wrangler.toml` to customise:

```toml
name = "cf-ai-assistant"         # Change your Worker name here
```

To swap the LLM, change the `MODEL` constant in `src/chatAgent.ts` and `src/summarizeWorkflow.ts`. Any Workers AI text generation model works, or swap to OpenAI / Anthropic via AI Gateway.

---

## Key Cloudflare Products Used

- [**Workers**](https://developers.cloudflare.com/workers/) — serverless request routing
- [**Workers AI**](https://developers.cloudflare.com/workers-ai/) — Llama 3.3 inference, no GPU setup
- [**Durable Objects**](https://developers.cloudflare.com/durable-objects/) — stateful per-user memory
- [**Workflows**](https://developers.cloudflare.com/workflows/) — durable async summarisation with retries
- [**Cloudflare Assets**](https://developers.cloudflare.com/workers/static-assets/) — static frontend hosting

---

## License

MIT
