# ✈️ TripMate AI — Multi-Agent Travel Planner

TripMate AI is a **LangGraph-powered multi-agent system** that plans complete trips end-to-end: it routes your request to the right specialists (flights, hotels, weather, budget), drafts a full itinerary, pauses for **human approval**, and then delivers a polished final plan — all served through a **FastAPI** backend with a web UI.

## 🧠 How It Works

TripMate AI is built as a single [LangGraph](https://github.com/langchain-ai/langgraph) `StateGraph` with a **supervisor**, an **input guardrail**, several **specialist agents**, and a **human-in-the-loop** approval checkpoint.

```
START
  │
  ▼
supervisor (guardrail + planning)
  │
  ├── guardrail_blocked ──────────────► END        (off-topic / unsafe request)
  │
  ├── flight_agent   ─┐
  ├── hotel_agent     ├──► itinerary_agent ──► human_approval ──► final_agent ──► END
  ├── weather_agent   │        ▲
  └── budget_agent   ─┘        │
                     (only the agents the supervisor selects run)
```

1. **Supervisor Agent** — first runs an LLM-based **input guardrail** to confirm the request is actually about travel (and not off-topic or harmful). If allowed, it decides *which* specialist agents are actually needed for the request and extracts structured trip constraints (destination, origin, duration, budget, travel style, preferences).
2. **Specialist Agents** (run only if selected by the supervisor):
   - **Flight Agent** — looks up airports/airlines via the AviationStack MCP server and recommends routes.
   - **Hotel Agent** — live hotel/accommodation search via the Tavily MCP server.
   - **Weather Agent** — current conditions + forecast via a custom OpenWeather-backed MCP server.
   - **Budget Agent** — estimates costs, flags budget risks, and suggests savings based on everything gathered so far.
3. **Itinerary Agent** — always runs; synthesizes all specialist output into a complete, budget-aware draft itinerary.
4. **Human-in-the-Loop Approval** — execution pauses (via LangGraph `interrupt`) and waits for the user to **approve** or send **revision feedback** through the API/UI.
5. **Final Agent** — produces the polished, final travel plan once approved.

State (including conversation history, trip constraints, and each agent's results) is checkpointed to **PostgreSQL** via `PostgresSaver`, so a trip-planning session can be paused and resumed by `thread_id`.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Agent orchestration | [LangGraph](https://github.com/langchain-ai/langgraph) (`StateGraph`, `PostgresSaver`, `interrupt`/`Command`) |
| LLM | [Groq](https://groq.com/) (`langchain-groq`, model: `openai/gpt-oss-20b`) |
| Tool protocol | [MCP](https://modelcontextprotocol.io/) via `langchain-mcp-adapters` (`MultiServerMCPClient`) |
| Live data sources | Tavily (search/hotels), AviationStack (flights, via `uvx aviationstack-mcp`), custom OpenWeather MCP server |
| Backend / API | [FastAPI](https://fastapi.tiangolo.com/) + Uvicorn |
| Frontend | Jinja2 templates + vanilla HTML/CSS/JS (`templates/index.html`, `static/`) |
| Persistence | PostgreSQL (`psycopg`, `langgraph-checkpoint-postgres`) |
| Containerization | Docker |

## 📁 Project Structure

```
.
├── app.py                          # FastAPI app: routes, request/response models
├── backend.py                      # LangGraph graph: agents, routing, run/resume logic
├── mcp_client.py                   # MultiServerMCPClient config (Tavily, AviationStack, Weather)
├── custom_weather_mcp_server.py    # Custom MCP server wrapping the OpenWeather API
├── mcp_client_test.py / test.py    # Manual test scripts for the MCP tools
├── tools/
│   ├── flight_tool.py              # AviationStack helpers (airport/country lookups, etc.)
│   └── tavily_tool.py              # Direct Tavily search helper
├── templates/index.html            # Web UI
├── static/{script.js, style.css}   # Web UI assets
├── requirements.txt
└── Dockerfile
```

## 🚀 Getting Started

### 1. Clone the repo
```bash
git clone https://github.com/PremSalokhe1060/TripMateAI---Multi-Agent-System.git
cd TripMateAI---Multi-Agent-System
```

### 2. Create a virtual environment & install dependencies
```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Install `uv` (needed for the AviationStack MCP server)
The flight agent runs the AviationStack MCP server as a subprocess via `uvx`:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install aviationstack-mcp --with "mcp[cli]<2"
```
> ⚠️ Pin `mcp[cli]<2` — `aviationstack-mcp` still imports `mcp.server.fastmcp`, which was removed in MCP SDK 2.0.0.

### 4. Configure environment variables
Create a `.env` file in the project root:
```env
GROQ_API_KEY=your_groq_api_key
TAVILY_API_KEY=your_tavily_api_key
AVIATION_STACK_API_KEY=your_aviationstack_api_key
OPENWEATHER_API_KEY=your_openweathermap_api_key
DATABASE_URL=postgresql://user:password@host:port/dbname
```
- `DATABASE_URL` should point to a Postgres instance (e.g. a [Render](https://render.com/) External Database URL). SSL is enforced automatically if not already specified.
- `AVIATIONSTACK_API_KEY` is also accepted as an alias for `AVIATION_STACK_API_KEY`.

### 5. Run the app
```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```
Then open **http://localhost:8000** in your browser.

### Run with Docker instead
```bash
docker build -t tripmate-ai .
docker run -p 8000:8000 --env-file .env tripmate-ai
```

## 🔌 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Web UI |
| `POST` | `/api/travel` | Start (or continue) a trip-planning conversation. Body: `{ "message": str, "thread_id": str \| null }` |
| `POST` | `/api/travel/approve` | Approve or reject the draft itinerary to resume the paused graph. Body: `{ "thread_id": str, "approved": bool, "feedback": str }` |
| `GET` | `/health` | Health check + enabled feature flags |

**Example flow:**
```bash
# 1) Kick off a planning request
curl -X POST http://localhost:8000/api/travel \
  -H "Content-Type: application/json" \
  -d '{"message": "Plan a 5-day trip to Tokyo in April on a mid-range budget"}'
# → returns a thread_id and, once the draft itinerary is ready, an interrupt asking for approval

# 2) Approve (or request revisions)
curl -X POST http://localhost:8000/api/travel/approve \
  -H "Content-Type: application/json" \
  -d '{"thread_id": "<thread_id>", "approved": true, "feedback": ""}'
```

## 🛡️ Key Features

- **Supervisor routing** — only the specialist agents actually needed for a request are run.
- **Input guardrail** — blocks off-topic or unsafe requests before any specialist work happens, with a "fail open" fallback if the guardrail model output can't be parsed.
- **Live tool use via MCP** — flights, hotel search, and weather all go through the Model Context Protocol rather than hardcoded API calls in the agent logic.
- **Human-in-the-loop** — the graph pauses via `interrupt()` before finalizing, so a human always reviews the draft itinerary.
- **Resumable sessions** — Postgres-backed checkpointing means a conversation can be resumed later using its `thread_id`.
- **Graceful degradation** — each specialist agent catches its own tool/network failures and falls back to general (clearly-labeled) guidance instead of crashing the whole graph.

## 📌 Notes

- `mcp_client_test.py` and `test.py` are ad-hoc scripts for manually exercising the MCP tools — not an automated test suite.
- The weather MCP server (`custom_weather_mcp_server.py`) is launched as a local subprocess using the current Python interpreter, so no separate deployment is needed for it.

## 🤝 Contributing

Issues and pull requests are welcome — feel free to open one if you'd like to extend TripMate AI with new specialist agents or data sources.

## 📄 License

No license specified yet — add one (e.g. MIT) if you intend for others to reuse this code.
