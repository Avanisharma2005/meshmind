# MeshMind

## Independent local semantic memory (Steps 5–6)

MeshMind uses **Qdrant Edge** as an embedded local vector engine inside the Python backend process. Qdrant Edge is **not a Qdrant Server running on localhost**; localhost is used only for the small FastAPI interface that the browser calls.

Machine A and Machine B use separate persistent Edge shard directories: Machine A is stored in `backend/data/qdrant_edge/`, and Machine B in `backend/data/qdrant_edge_machine_b/`. The Machine A shard contains its one bearing race wear incident. Machine B's shard is initialized empty and does not receive Machine A's incident. The FastEmbed model is cached under `backend/data/models/`. These are local runtime data and are git-ignored.

The incident description is converted into a 384-dimensional embedding using FastEmbed's `sentence-transformers/all-MiniLM-L6-v2` model. The named `incident_text` vector uses cosine distance. For a semantic search, the submitted query is embedded with the same locally cached model and Qdrant Edge returns its nearest point and cosine similarity score. No embedding API or remote database is called at runtime.

### Install dependencies (PowerShell)

From the repository root:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\python -m pip install --upgrade pip
backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
```

If Python 3.14 is not installed, substitute an installed Python version supported by the packages (for example `py -3.12`).

### Download and cache the embedding model

Run this once while internet access is available:

```powershell
cd backend
.\.venv\Scripts\python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2', cache_dir='data/models')"
cd ..
```

The backend loads the model with `local_files_only=True`, so startup and search use the cache and do not make runtime model downloads. The first cache operation above fetches model files from the FastEmbed model source.

### Start the backend

From the repository root, in one terminal:

```powershell
cd backend
.\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

At startup the backend loads each existing shard, or creates it with `EdgeShard.create()`. It inserts Machine A's deterministic incident point only if it is absent; Machine B remains empty. Repeated restarts preserve the two separate stores and do not create duplicate points. The status endpoint returns the exact count for each machine.

### Start the frontend

In another terminal at the repository root:

```powershell
python -m http.server 5500 --bind 127.0.0.1
```

Open <http://127.0.0.1:5500>. Machine A's Local Memory panel reads its status, count, and incident payload from the local API. If the backend is stopped, that panel reports `Local memory backend unavailable`; other dashboard sections continue to work.

### Verify independent machine memories

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/memory/status
Invoke-RestMethod http://127.0.0.1:8000/api/memory/machine/M-A-001
```

The status response has a `machines` array with each `machine_id`, `memory_backend`, and exact `memory_count`. Machine A starts with its historical record; Machines B and C start empty. Machine C uses `backend/data/qdrant_edge_machine_c`, separate from Machine A's `qdrant_edge` and Machine B's `qdrant_edge_machine_b`. The legacy top-level status fields still report Machine A for Step 5 callers.

### Test semantic search offline

After installing dependencies and caching the model once, disconnect from the internet, start the backend and frontend, then send:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/memory/search -ContentType 'application/json' -Body '{"machine_id":"M-A-001","query":"motor is vibrating and getting hot"}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/memory/search -ContentType 'application/json' -Body '{"machine_id":"M-B-002","query":"motor is vibrating and getting hot"}'
```

The Machine A response contains `matching_incident`, `similarity_score`, and the stored `payload`. Machine B returns null match fields while its shard is empty. Each query is embedded locally and sent only to the Edge shard for the requested `machine_id`. Semantic search does not call an external embedding API or database.

## Evidence-based AI explanation (Step 9)

After Machine B detects an anomaly and finishes its local search (and Machine A peer search when needed), FastAPI sends the structured evidence to Gemini using its Interactions REST API and JSON Schema output. The default model is `gemini-3.1-flash-lite`; set `GEMINI_MODEL` to override it. The backend restricts diagnoses to names supplied by the search evidence or `Insufficient evidence`, and restricts evidence bullets to facts built from the request. The historical Machine A incident is supporting evidence, not proof. If Gemini is unavailable or not configured, the backend returns a deterministic local-rules explanation with no confidence percentage. AI explanations are not generated on every simulator tick; the frontend deduplicates requests using the anomaly and material search/peer evidence.

Set the API key in the backend environment. The key stays on the server and is sent only as the Gemini API request header; it is never sent to browser JavaScript:

```powershell
$env:GEMINI_API_KEY = "your-api-key"
$env:GEMINI_MODEL = "gemini-3.1-flash-lite" # optional; this is the default
cd backend
.\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

The `.env` patterns are already excluded by `.gitignore`; do not commit API keys. The `/api/ai/explain` endpoint returns HTTP 200 with `explanation_source: "local_rules"` and `ai_status: "not_configured"` when `GEMINI_API_KEY` is absent. Quota/rate-limit, authentication, timeout, and provider errors also use the local-rules fallback. No additional Python dependency is required.

## Gateway to Qdrant Cloud (Step 14)

The Gateway can synchronize approved, technician-validated local knowledge to a Qdrant Cloud collection. Configure all three values in the environment of the backend process; missing values safely leave the local queue unchanged and report `Cloud not configured`:

```powershell
$env:QDRANT_CLOUD_URL = "https://your-cluster-endpoint"
$env:QDRANT_CLOUD_API_KEY = "your-qdrant-cloud-api-key"
$env:QDRANT_CLOUD_COLLECTION = "meshmind_global_memory"
cd backend
.\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

The configured collection is created on the first explicit synchronization if it does not exist. Its named `incident_text` vector uses the existing 384-dimensional FastEmbed embedding from the validated local Qdrant Edge point. No second model or local database is created. The backend never logs or returns the Cloud API key. `/api/gateway/status` performs a real collection reachability check; `POST /api/gateway/sync` is the only upload action. It reclassifies the local queue and uploads only `SYNC NOW` and `SYNC` decisions, with deterministic Cloud point IDs. Successful uploads alone transition their original queue records to `Synced`; failed uploads remain retryable as `Failed`. Duplicate Cloud IDs are checked before upload. The dashboard's Global Memory panel reads records back from the configured Cloud collection and does not infer global availability from the local queue.

The status-area control can locally disable Cloud synchronization; enabling it again performs a backend reachability check. It cannot force Cloud to `ONLINE` when Qdrant Cloud is unreachable or unconfigured.

Without Cloud configuration, all local Edge memory, semantic search, peer communication, technician validation, and queue records remain available. The Gateway reports the configuration failure and does not mark anything synchronized.

## Machine C Cloud knowledge retrieval (Step 15)

Machine C (`M-C-003`, Level 5, Conveyor Motor) starts with an empty independent Edge shard at `backend/data/qdrant_edge_machine_c`; startup does not seed bearing knowledge. Use **Retrieve Global Knowledge** while Machine C is selected to call `POST /api/machine-c/retrieve-global`. The backend reads pages from the configured existing Qdrant Cloud collection, accepts only technician-confirmed `SYNC NOW`/`SYNC` Conveyor Motor bearing wear/race/failure knowledge, and imports the Cloud point's existing `incident_text` vector and validated payload into Machine C's Edge shard. No Machine A/B Edge search or direct machine-to-machine copy occurs. Imported Edge point IDs are deterministic from the Cloud point ID, so repeating retrieval does not create another local point. The operation does not write to or alter Qdrant Cloud or its collection. Its response separates Cloud records retrieved, local imports, and the subsequent semantic search made only against Machine C's Edge shard. Cloud must be configured and online for retrieval; the local Machine C shard/search remain local when Cloud is unavailable.

### Test Step 9 from Git Bash

Use the same evidence body for the three provider cases:

```bash
STEP9_BODY=$(cat <<'JSON'
{"machine_b":{"machine_id":"M-B-002","machine_type":"Conveyor Motor","current_temperature":93.2,"current_vibration":6.4,"current_current":35.2,"current_pressure":5.1,"anomaly_state":"CRITICAL","triggered_sensors":["temperature","vibration"],"anomaly_query_description":"Conveyor Motor with increased vibration and elevated temperature"},"machine_b_local_search":{"useful_match_found":false,"matching_incident":null,"similarity_score":null},"machine_a_peer_knowledge":{"source_machine_id":"M-A-001","incident_type":"Bearing race wear","symptoms":["increased vibration","increased temperature"],"machine_type":"Conveyor Motor","resolution":"Machine inspected; bearing replacement required","technician_confirmed":true,"similarity_score":0.6028}}
JSON
)
```

For each case, start/restart the backend from a Git Bash terminal with that case's `GEMINI_API_KEY` environment. Run the `curl` command from another Git Bash terminal. Changing an environment variable in the curl terminal does not change an already-running backend process.

Case A — key missing:

```bash
unset GEMINI_API_KEY
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:8000/api/ai/explain -H 'Content-Type: application/json' --data "$STEP9_BODY"
```

Expect HTTP 200, `explanation_source: "local_rules"`, `ai_status: "not_configured"`, a matched-check count, and no confidence percentage.

Case B — Gemini key available:

```bash
export GEMINI_API_KEY='your-key-in-this-terminal-only'
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:8000/api/ai/explain -H 'Content-Type: application/json' --data "$STEP9_BODY"
```

Expect HTTP 200 and `explanation_source: "gemini"`, `ai_status: "success"` when the model and account have quota. Keep the key private; do not paste it into chat or commit it.

Case C — quota/rate limit/provider failure:

With a key configured, call the same command after Gemini reports quota/rate-limit exhaustion or is unavailable. Expect HTTP 200 and `explanation_source: "local_rules"`; `ai_status` will be `quota_exhausted`, `unavailable`, or another safe provider status. The response omits raw provider errors and secrets.
