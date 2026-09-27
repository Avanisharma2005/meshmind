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

The status response has a `machines` array with each `machine_id`, `memory_backend`, and exact `memory_count`. Machine A should report one memory and Machine B zero; the legacy top-level status fields still report Machine A for Step 5 callers.

### Test semantic search offline

After installing dependencies and caching the model once, disconnect from the internet, start the backend and frontend, then send:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/memory/search -ContentType 'application/json' -Body '{"machine_id":"M-A-001","query":"motor is vibrating and getting hot"}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/memory/search -ContentType 'application/json' -Body '{"machine_id":"M-B-002","query":"motor is vibrating and getting hot"}'
```

The Machine A response contains `matching_incident`, `similarity_score`, and the stored `payload`. Machine B returns null match fields while its shard is empty. Each query is embedded locally and sent only to the Edge shard for the requested `machine_id`. No Qdrant Server, Qdrant Cloud, peer communication, or external AI service is involved.
