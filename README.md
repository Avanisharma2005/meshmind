# MeshMind

## Distributed AI Memory for Industrial Machines

MeshMind is an **offline-first distributed AI memory prototype** for industrial machines.

It demonstrates how machines can:

1. Monitor simulated sensor data
2. Detect anomalies locally
3. Search their own local semantic memory
4. Request knowledge from nearby machines
5. Analyze retrieved evidence using local AI
6. Require technician verification
7. Queue validated knowledge locally
8. Classify synchronization through a Gateway
9. Synchronize approved knowledge to Qdrant Cloud
10. Retrieve shared knowledge back into another machine's local Edge memory

The prototype is designed so that **local machine intelligence continues to work even when Cloud connectivity is unavailable**.

---

# Architecture

```text
                         ┌─────────────────────┐
                         │    Qdrant Cloud     │
                         │   Global Memory     │
                         └──────────▲──────────┘
                                    │
                              Approved Sync
                                    │
                         ┌──────────┴──────────┐
                         │       Gateway       │
                         │ Classification      │
                         │ MQTT / mDNS          │
                         └──────────▲──────────┘
                                    │
                       Local Mining Network
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
      ┌───────▼───────┐     ┌──────▼────────┐    ┌──────▼────────┐
      │   Machine A   │     │   Machine B   │    │   Machine C   │
      │   Level 1     │     │   Level 3     │    │   Level 5     │
      │ Conveyor Motor│     │ Conveyor Motor │    │ Conveyor Motor│
      └───────┬───────┘     └──────┬────────┘    └──────┬────────┘
              │                     │                     │
        Qdrant Edge           Qdrant Edge           Qdrant Edge
        Local Memory          Local Memory          Local Memory
              │                     │
              └──── Peer Evidence ──┘
                                    │
                              Local AI
                                    │
                              Ollama
                                    │
                              Gemma 3 4B
```

---

# Important: Localhost vs Qdrant Edge

MeshMind uses **Qdrant Edge** as an embedded local vector engine inside the Python backend.

Qdrant Edge is **not a Qdrant Server running on localhost**.

The following architecture is used:

```text
Browser
   │
   │ HTTP
   ▼
FastAPI
   │
   ├── Qdrant Edge
   ├── Ollama
   ├── MQTT
   └── mDNS
```

`127.0.0.1:8000` is only the FastAPI backend.

Ollama runs separately on:

```text
http://localhost:11434
```

---

# Machine Memory

Each machine has an independent persistent Qdrant Edge shard.

```text
backend/data/
│
├── qdrant_edge/
│   └── Machine A
│
├── qdrant_edge_machine_b/
│   └── Machine B
│
├── qdrant_edge_machine_c/
│   └── Machine C
│
└── models/
    └── FastEmbed model cache
```

Machine A contains the historical:

```text
Bearing race wear
```

incident.

Machine B starts with an independent local memory.

Machine C also starts with an independent local memory and can retrieve approved global knowledge from Qdrant Cloud.

These runtime directories are local and should not be committed to Git.

---

# Requirements

Install the following on the machine running MeshMind:

* Git
* Python 3.12+ / a Python version supported by the project dependencies
* Ollama
* Gemma 3 4B
* Internet access during initial dependency/model setup
* Optional: Qdrant Cloud credentials
* Optional: MQTT broker

The basic local AI demonstration does **not** require Qdrant Cloud.

---

# 1. Clone the Repository

Clone the finalized branch:

```powershell
git clone -b meshmind-full-system https://github.com/Avanisharma2005/meshmind.git
```

Enter the project:

```powershell
cd meshmind
```

If you already cloned the repository:

```powershell
git switch meshmind-full-system
git pull origin meshmind-full-system
```

---

# 2. Create Python Virtual Environment

From the repository root:

```powershell
python -m venv backend\.venv
```

Activate it:

```powershell
backend\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, you can use the Python executable directly instead of activating the environment.

---

# 3. Install Backend Dependencies

From the repository root:

```powershell
backend\.venv\Scripts\python -m pip install --upgrade pip
```

Then:

```powershell
backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
```

Verify Python:

```powershell
backend\.venv\Scripts\python --version
```

---

# 4. Download the Local Embedding Model

MeshMind uses FastEmbed with:

```text
sentence-transformers/all-MiniLM-L6-v2
```

The model produces 384-dimensional embeddings.

Run this once while Internet access is available:

```powershell
cd backend

..\.venv\Scripts\python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2', cache_dir='data/models')"

cd ..
```

The model is cached locally under:

```text
backend/data/models/
```

After the model has been cached, semantic Edge search does not require an external embedding API.

---

# 5. Install Ollama

MeshMind's AI recommendation system uses:

```text
Ollama
Gemma 3 4B
```

Install Ollama on the new machine.

After installation, verify:

```powershell
ollama --version
```

Then download the model:

```powershell
ollama pull gemma3:4b
```

Verify that the model exists:

```powershell
ollama list
```

You should see:

```text
gemma3:4b
```

Ollama normally runs locally at:

```text
http://localhost:11434
```

Verify:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

---

# 6. Environment Configuration

MeshMind can run locally without Cloud credentials.

For the complete distributed prototype, configure the optional services through the backend environment.

Create:

```text
backend/.env
```

Do **not** commit this file.

Example:

```env
AI_PROVIDER=ollama

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b

MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_CLIENT_ID=meshmind-gateway

QDRANT_CLOUD_URL=https://your-cluster-endpoint
QDRANT_CLOUD_API_KEY=your-qdrant-cloud-api-key
QDRANT_CLOUD_COLLECTION=meshmind_global_memory
```

Replace only the values that belong to your own environment.

Never commit:

```text
QDRANT_CLOUD_API_KEY
```

or any other secret.

The repository `.gitignore` excludes local environment files.

---

# 7. Optional MQTT

MQTT is used by the Gateway for the local machine network.

The prototype can also use its existing local/direct fallback when MQTT is unavailable.

If an MQTT broker is available, configure:

```env
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_CLIENT_ID=meshmind-gateway
```

The dashboard reports the actual MQTT state:

```text
CONNECTED
NOT CONFIGURED
DISCONNECTED
ERROR
```

Do not hardcode the displayed connection state.

---

# 8. Optional Qdrant Cloud

Qdrant Cloud is used for shared Global Memory.

Configure:

```env
QDRANT_CLOUD_URL=https://your-cluster-endpoint
QDRANT_CLOUD_API_KEY=your-qdrant-cloud-api-key
QDRANT_CLOUD_COLLECTION=meshmind_global_memory
```

If Cloud is unavailable or not configured:

```text
Local Edge memory
       ↓
Semantic search
       ↓
Peer knowledge
       ↓
Local AI
       ↓
Technician verification
       ↓
Local queue
```

continues to work.

Cloud is only required for:

```text
Gateway synchronization
Global Memory
Machine C Cloud retrieval
```

---

# 9. Start the Backend

Open Terminal 1.

From the repository root:

```powershell
cd backend
```

Start FastAPI:

```powershell
..\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Expected:

```text
Uvicorn running on http://127.0.0.1:8000
```

Keep this terminal running.

---

# 10. Verify the Backend

Open another PowerShell terminal.

From any directory:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/mesh/status | ConvertTo-Json -Depth 8
```

Check AI:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/ai/status | ConvertTo-Json -Depth 5
```

Expected AI state when Ollama is available:

```text
provider       : ollama
status         : connected
connected      : True
model_available: True
model          : gemma3:4b
```

Check Gateway:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/gateway/status | ConvertTo-Json -Depth 8
```

---

# 11. Start the Frontend

Open Terminal 2.

From the repository root:

```powershell
python -m http.server 5500 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:5500
```

The browser communicates with the FastAPI backend at:

```text
http://127.0.0.1:8000
```

---

# 12. Complete Demo Flow

The intended demo starts from:

```text
Reset Demo
```

Then use the existing dashboard controls.

## Step 1 — Reset

Click:

```text
Reset Demo
```

This returns the demonstration to its clean state.

---

## Step 2 — Trigger Machine B Anomaly

Select Machine B and trigger:

```text
Trigger Anomaly
```

The simulator produces the demonstrated critical condition:

```text
Temperature: 93.2 °C
Vibration: 6.4 mm/s
```

The anomaly detector marks Machine B:

```text
CRITICAL
```

The values are generated by the existing simulator and are not physical sensor measurements.

---

# Step 3 — Local Edge Search

Machine B searches its own local Qdrant Edge memory first.

Expected:

```text
No useful local match found
```

Machine B does not directly access Machine A's Edge database.

---

# Step 4 — Peer Knowledge

Use:

```text
Ask Nearby Machine
```

The flow is:

```text
Machine B
    ↓
Peer request
    ↓
Machine A
    ↓
Machine A local Edge search
    ↓
Bearing race wear evidence
    ↓
Machine B
```

Expected evidence includes:

```text
Source: M-A-001
Incident: Bearing race wear
Symptoms:
  increased vibration
  increased temperature

Resolution:
  Machine inspected; bearing replacement required

Technician confirmation:
  Confirmed
```

The similarity value is generated from the actual semantic search.

---

# Step 5 — Local AI

After peer evidence is available, MeshMind sends the actual evidence to:

```text
FastAPI
   ↓
local_ai.py
   ↓
Ollama
   ↓
Gemma 3 4B
```

The AI must use the supplied evidence.

It must distinguish:

```text
Evidence
Reasoning
Recommendation
Confidence
```

The model must not invent:

* sensor readings
* maintenance history
* inspection results
* unsupported component failures
* unsupported operating conditions

The existing confidence ceiling is preserved at:

```text
90%
```

The AI recommendation is generated dynamically.

It is not hardcoded.

---

# Step 6 — Technician Verification

The recommendation is displayed in:

```text
Technician Verification
```

The technician can:

```text
Confirm Diagnosis
```

or:

```text
Reject Diagnosis
```

AI does not automatically validate itself.

Technician confirmation is required before knowledge enters the validated synchronization flow.

---

# Step 7 — Sync Queue

After technician confirmation, the validated incident enters the local synchronization queue.

The Gateway classifies the item.

Possible decisions include:

```text
SYNC NOW
SYNC
AGGREGATE
SKIP
LOCAL ONLY
```

Only appropriate Gateway decisions are synchronized to Cloud.

---

# Step 8 — Qdrant Cloud

When Cloud is available:

```text
Technician validation
        ↓
Local queue
        ↓
Gateway classification
        ↓
SYNC NOW / SYNC
        ↓
Qdrant Cloud
```

Cloud synchronization is explicit.

The system does not automatically upload every local event.

---

# Step 9 — Machine C

Machine C starts with its own empty Edge memory.

Use:

```text
Retrieve Global Knowledge
```

Machine C retrieves approved knowledge from Qdrant Cloud and imports it into:

```text
backend/data/qdrant_edge_machine_c/
```

The imported knowledge becomes available to Machine C's local semantic search.

Machine C does not directly copy Machine A's Edge database.

---

# Local-First Design

MeshMind intentionally separates:

```text
LOCAL EDGE
    ↓
PEER NETWORK
    ↓
GATEWAY
    ↓
CLOUD
```

Cloud availability does not determine whether local machine intelligence works.

For example:

```text
Qdrant Cloud = OFFLINE
MQTT = UNAVAILABLE
```

The following can still operate:

```text
Sensor simulation
Anomaly detection
Local Edge search
Peer knowledge
Local AI
Technician verification
Local queue
```

---

# AI Configuration

MeshMind currently uses:

```text
Provider: Ollama
Model: gemma3:4b
```

Check AI status:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/ai/status | ConvertTo-Json -Depth 5
```

Expected:

```text
provider        : ollama
status          : connected
connected       : True
model_available : True
model           : gemma3:4b
```

Check loaded models directly:

```powershell
Invoke-RestMethod http://localhost:11434/api/ps | ConvertTo-Json -Depth 5
```

The first AI inference can take longer while the model is loaded.

Subsequent requests may reuse the loaded model.

---

# AI Error Handling

The application distinguishes AI failures instead of displaying a fake successful recommendation.

Relevant failure states include:

```text
Ollama unavailable
Model unavailable
Generation timeout
Malformed AI response
```

If Ollama is unavailable, the dashboard should report the AI failure rather than presenting a fabricated recommendation.

---

# AI Duplicate Protection

The frontend uses the evidence fingerprint/state mechanism to avoid repeatedly sending identical AI requests.

Conceptually:

```text
Same anomaly
+
Same peer evidence
+
Same evidence fingerprint
        ↓
No unnecessary duplicate inference
```

A new inference is appropriate when the underlying evidence changes or a new demo lifecycle requires it.

---

# Semantic Search

Machine A and Machine B use independent Edge stores.

Example:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/memory/search `
  -ContentType 'application/json' `
  -Body '{"machine_id":"M-A-001","query":"motor is vibrating and getting hot"}'
```

Machine B:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/memory/search `
  -ContentType 'application/json' `
  -Body '{"machine_id":"M-B-002","query":"motor is vibrating and getting hot"}'
```

Machine A can return its historical incident.

Machine B's clean shard should not automatically contain Machine A's incident.

---

# Useful API Endpoints

## System status

```text
GET /api/mesh/status
```

Returns:

* Gateway status
* MQTT status
* mDNS status

---

## AI status

```text
GET /api/ai/status
```

Returns:

* provider
* connection status
* model availability
* model name

---

## Gateway status

```text
GET /api/gateway/status
```

Returns actual Qdrant Cloud connectivity and collection status.

---

## Local memory status

```text
GET /api/memory/status
```

---

## Machine memory

```text
GET /api/memory/machine/{machine_id}
```

---

## Semantic search

```text
POST /api/memory/search
```

---

## Machine A peer request

```text
POST /api/machine-a/ask
```

---

## AI explanation

```text
POST /api/ai/explain
```

---

## Demo reset

```text
POST /api/demo/reset
```

---

## Gateway synchronization

```text
POST /api/gateway/sync
```

---

## Machine C Cloud retrieval

```text
POST /api/machine-c/retrieve-global
```

---

# mDNS

The Gateway registers itself using mDNS/Zeroconf.

The service uses the MeshMind service type:

```text
_meshmind._tcp.local.
```

The dashboard displays actual registration information when available.

Example:

```text
Gateway service registered
Host
LAN address
Port
Identity
```

mDNS registration runs independently so that slow discovery operations do not block FastAPI startup.

---

# MQTT

The Gateway can connect to the configured MQTT broker.

Example:

```text
Host: localhost
Port: 1883
Client ID: meshmind-gateway
```

The dashboard reports the actual broker state.

MQTT is not required for the core local Edge + AI demonstration when the existing direct local fallback is available.

---

# Cloud OFF Demonstration

MeshMind can demonstrate offline operation.

After the system is running, use:

```text
SET OFFLINE
```

The local components remain usable.

Cloud synchronization should not falsely report success when Cloud is unavailable.

After enabling Cloud again:

```text
CLOUD ON
```

the application performs a real backend connectivity check.

---

# Reset Demo

The dashboard's:

```text
Reset Demo
```

control resets the demonstration state while preserving the intended seeded Machine A knowledge.

It is useful to start every live demonstration with:

```text
Reset Demo
```

This ensures that previous technician confirmations, queue entries, and demo imports do not affect the next run.

---

# Important Security Rules

Never commit:

```text
.env
backend/.env
QDRANT_CLOUD_API_KEY
```

Never put API keys into:

```text
index.html
js/app.js
css/styles.css
```

Never hardcode Cloud credentials into Python source.

Use environment variables.

---

# Git-Ignored Runtime Files

The following are runtime-generated and should remain outside Git:

```text
backend/.venv/
backend/data/
backend/__pycache__/
backend/memory/__pycache__/
.env
backend/.env
```

Do not delete runtime data unless you intentionally want to rebuild the local memory state.

---

# Development Verification

From the repository root:

Check JavaScript syntax:

```powershell
node --check js/app.js
```

Check Git whitespace:

```powershell
git diff --check
```

Check repository state:

```powershell
git status
```

The backend can be syntax checked with Python AST parsing if required.

---

# Troubleshooting

## Backend does not start

Check whether port 8000 is already being used:

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
```

Stop the old backend process if necessary.

Then restart:

```powershell
cd backend
..\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

---

## Frontend does not open

Start:

```powershell
python -m http.server 5500 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5500
```

---

## AI says Ollama is unavailable

Check:

```powershell
ollama list
```

Make sure:

```text
gemma3:4b
```

is installed.

Then:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

Restart the MeshMind backend after fixing Ollama.

---

## FastEmbed model missing

Run:

```powershell
cd backend

..\.venv\Scripts\python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2', cache_dir='data/models')"

cd ..
```

---

## Cloud is offline

Check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/gateway/status | ConvertTo-Json -Depth 8
```

Verify:

```text
QDRANT_CLOUD_URL
QDRANT_CLOUD_API_KEY
QDRANT_CLOUD_COLLECTION
```

are correctly configured in the environment used to start the backend.

Cloud being offline does not prevent the local Edge + AI demonstration from working.

---

# Running MeshMind After Initial Setup

Once everything has been installed, only two terminals are normally required.

### Terminal 1 — Backend

```powershell
cd meshmind
cd backend
..\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

### Terminal 2 — Frontend

```powershell
cd meshmind
python -m http.server 5500 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5500
```

Ollama should already be installed and running in the background.

---

# Complete Demo Flow

```text
                    SENSOR SIMULATION
                           │
                           ▼
                    MACHINE B ANOMALY
                           │
                           ▼
                  LOCAL EDGE SEARCH
                           │
                     No useful match
                           │
                           ▼
                    PEER REQUEST
                           │
                           ▼
                       MACHINE A
                           │
                    Local Edge Search
                           │
                           ▼
                  Bearing race wear
                           │
                           ▼
                    PEER EVIDENCE
                           │
                           ▼
                     LOCAL AI
                           │
                           ▼
                     OLLAMA
                           │
                       Gemma 3 4B
                           │
                           ▼
                    AI RECOMMENDATION
                           │
                           ▼
                  TECHNICIAN VERIFICATION
                     │               │
                   Reject          Confirm
                     │               │
                     ▼               ▼
                  No sync        LOCAL QUEUE
                                     │
                                     ▼
                                  GATEWAY
                                     │
                          ┌──────────┴──────────┐
                          │                     │
                       LOCAL ONLY          SYNC NOW/SYNC
                                                │
                                                ▼
                                         QDRANT CLOUD
                                                │
                                                ▼
                                          MACHINE C
                                                │
                                                ▼
                                         LOCAL EDGE
```

---

# Project Status

The current prototype demonstrates:

* Live simulated sensor monitoring
* Dynamic anomaly detection
* Independent Qdrant Edge memory
* Machine-specific local memory
* Semantic search using local embeddings
* Machine-to-machine peer knowledge
* Evidence fingerprinting
* Local AI using Ollama
* Gemma 3 4B inference
* Evidence-grounded recommendations
* Confidence ceiling
* AI duplicate-request protection
* Technician confirmation/rejection
* Local synchronization queue
* Gateway classification
* MQTT status
* mDNS service discovery
* Qdrant Cloud synchronization
* Cloud/global memory
* Machine C Cloud-to-Edge retrieval
* Offline/local operation
* Resettable demonstration state

The AI recommendation is **advisory**. Technician verification remains the required validation step before knowledge enters the approved synchronization flow.

---

# Repository

GitHub:

```text
https://github.com/Avanisharma2005/meshmind
```

Primary demo branch:

```text
meshmind-full-system
```

## MeshMind

**Distributed AI Memory for Industrial Machines**
