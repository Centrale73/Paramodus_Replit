# Paramodus Workspace (Agentic Workspace)

## Overview
A web-based AI assistant with multiple LLM providers, local RAG, group contexts, scheduled tasks, a plugin skill system, and team (swarm) mode. Built with Agno, Flask, and Vanilla JS.

## Architecture

- **server.py** — Flask server (port 5000). REST + SSE API. Per-session message queues (sequential, no race conditions). Background scheduler thread.
- **agents/workspace_agent.py** — Agno agent factory. Supports group system prompts, dynamic skill loading, and Researcher+Writer team mode.
- **database.py** — SQLite persistence for: messages, sessions, groups, scheduled tasks.
- **skills/** — Auto-loaded skill plugins. Each exposes `register(agent) -> Agent`.
- **ui/** — HTML/CSS/Vanilla JS frontend with Anime.js and Marked.js.

## Features

### 1. Isolated Group Contexts
- Groups table in SQLite with `name` and `system_prompt`.
- Active group's system prompt becomes the agent's description/persona.
- Select, create, and edit groups from the Settings sidebar.
- Current group shown as a badge in the header.

### 2. Scheduled Tasks
- Tasks stored in SQLite with name, prompt, interval_seconds, enabled flag.
- Background thread polls every 60s and runs enabled tasks when their interval has elapsed.
- Results streamed to the UI chat via SSE as `[Scheduled: task_name]` messages.
- Manage tasks from the Settings sidebar.

### 3. Skill-Style Extensibility
- Drop a `.py` file in `skills/` — it's auto-imported at agent creation.
- Must export `register(agent: Agent) -> Agent`.
- Built-in skills: `web_search.py` (DuckDuckGo), `summarize_pdf.py` (knowledge base query).
- See `SKILLS_README.md` for full guide.

### 4. Agent Swarms (Team Mode)
- Toggle "Team Mode" in the header to activate.
- Spins up a Researcher agent + Writer agent using Agno `Team`.
- Both use the active provider/model (defaults to Groq Llama3 for speed).
- The Researcher has web search skill loaded; result is synthesised by the Writer.

### 5. Per-Session Message Queues
- Each session gets its own `queue.Queue` with a dedicated worker thread.
- Messages are processed sequentially per session — no race conditions.
- New sessions/session switches create fresh queues automatically.

## Running the App
```
python server.py
```
Runs on `0.0.0.0:5000`

## Dependencies
See `requirements.txt`. Key packages:
- Flask, flask-cors, gunicorn
- agno (agent framework + Team)
- lancedb, fastembed (local vector search)
- openai, anthropic, groq, google-genai, ddgs
- schedule (task scheduler)
- sqlalchemy, pypdf, aiofiles

## API Keys (Environment Variables)
Set in Replit secrets:
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- `GROQ_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `PERPLEXITY_API_KEY`
- `DEFAULT_PROVIDER` (optional, defaults to "openai")
- `DEFAULT_MODEL` (optional)

## Deployment
Configured for VM deployment (always-running) — required because of in-memory state, local SQLite, and LanceDB.
