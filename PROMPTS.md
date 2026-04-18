# PROMPTS.md — AI Prompts Used in Development

This file documents the prompts used with AI assistance (Claude Sonnet 4.5) during the development of this project, as required by the assignment instructions.

---

## 1. Initial Architecture Planning

**Prompt:**
> "I'm building an AI-powered application for a Cloudflare internship assignment. It needs: an LLM (Llama 3.3 on Workers AI), a Workflow or Durable Object for coordination, user chat input, and memory/state. Design the cleanest architecture for a personal AI assistant that remembers conversations across sessions. Explain how the four components connect."

**What it produced:**
The core architecture decision: one Durable Object per user (keyed by session cookie UUID) to store conversation history, plus a Workflow for async summarisation when conversations grow long. This avoids hitting the LLM context window limit while keeping memory intact.

---

## 2. Durable Object — Chat Agent

**Prompt:**
> "Write a Cloudflare Durable Object class called `ChatAgent` in TypeScript that:
> - Stores conversation history (user + assistant messages) in DO storage
> - On POST /chat: appends the user message, calls Workers AI with the full history as context (last 20 messages) plus a system prompt that includes any earlier summary, appends the AI response, persists state, and triggers a summarisation Workflow if message count > 30
> - On GET /history: returns messages, summary, and total count
> - On POST /clear: resets all state
> - On POST /apply-summary: accepts a summary string from the Workflow and trims older messages
> Use the `DurableObject` base class from `cloudflare:workers` and the model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`."

**What it produced:**
The full `ChatAgent` class with typed state, `blockConcurrencyWhile` for safe initialisation, and the `buildSystemPrompt()` helper that weaves in the running summary.

---

## 3. Cloudflare Workflow — Summarisation

**Prompt:**
> "Write a Cloudflare Workflow class called `SummarizeWorkflow` that extends `WorkflowEntrypoint`. It receives `{ sessionId, messages }` as params. In step 1, call Workers AI with a system prompt that asks it to produce a compact third-person summary (max 300 words) of the conversation. In step 2, use `env.CHAT_AGENT.idFromString(sessionId)` to get the Durable Object and POST the summary to its `/apply-summary` endpoint. Include retry semantics via the step system."

**What it produced:**
The `SummarizeWorkflow` class with two named steps, automatic retries courtesy of the Workflows engine, and clean separation of the summarisation concern from the hot chat path.

---

## 4. Worker Router

**Prompt:**
> "Write a Cloudflare Worker `fetch` handler that:
> - Routes GET/POST to /api/* to a Durable Object identified by a session cookie (cookie name: memo_session, fallback: crypto.randomUUID())
> - Rewrites the URL to strip /api before forwarding to the DO
> - Sets the session cookie on responses with a 30-day max-age
> - Handles CORS preflight with OPTIONS
> - Has a /health endpoint
> The DO namespace binding is CHAT_AGENT."

**What it produced:**
The `src/index.ts` router with cookie extraction, DO routing, and CORS handling.

---

## 5. Chat UI

**Prompt:**
> "Design a beautiful, dark-themed chat UI in a single HTML file (no external dependencies, no build step). It should:
> - Have a fixed header with app name 'Memo', a live message counter badge, and a clear history button
> - Show a welcome screen with four prompt chips when the conversation is empty
> - Render user messages right-aligned in purple and AI messages left-aligned in a dark surface colour
> - Show an animated three-dot typing indicator while the AI is responding
> - Auto-resize the textarea up to 150px
> - Submit on Enter, newline on Shift+Enter
> - On load, fetch GET /api/history and render existing messages
> - Show a banner when earlier messages have been summarised
> - Format markdown (bold, italic, code blocks) in AI responses
> Use CSS custom properties for theming. Keep it clean and professional."

**What it produced:**
The full `public/index.html` with the dark theme, animated elements, markdown formatter, typing indicator, toast notifications, and history loading.

---

## 6. System Prompt Refinement

**Prompt:**
> "Write a concise system prompt for an AI assistant called Memo that:
> - Establishes it has persistent memory of the current conversation
> - Tells it to be helpful, concise, and avoid filler phrases
> - Includes today's date
> - Optionally appends a summary of earlier conversation with a clear label
> Keep it under 120 words."

**What it produced:**
The `buildSystemPrompt()` method's template used in `ChatAgent`.

---

## 7. README

**Prompt:**
> "Write a professional README.md for a Cloudflare Workers project called `cf_ai_assistant`. Include: a short description, an ASCII architecture diagram, a table showing the four required components and how each is satisfied, a step-by-step getting started guide (clone, install, dev, deploy), a project structure tree, an API endpoints table, and a products used section with links."

**What it produced:**
The `README.md` in this repository.

---

## Notes

All generated code was reviewed, tested locally with `wrangler dev`, and edited for correctness — particularly around Cloudflare-specific APIs (`DurableObject` base class, `WorkflowEntrypoint`, `blockConcurrencyWhile`, `ctx.storage`, Workflow step semantics). The AI suggestions were treated as a starting point, not a final answer.
