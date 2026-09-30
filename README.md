# MeshMind

### Distributed AI Memory for Offline Industrial Machines

MeshMind is an offline-first AI memory system designed for industrial machines operating in environments where internet connectivity may be unreliable.

Instead of requiring every machine to continuously communicate with a cloud service, MeshMind gives machines **local semantic memory** and provides a **Gateway intelligence layer** for deciding how knowledge should be handled.

The prototype focuses on two core ideas:

* **Local AI Memory** — machines can store and search operational knowledge locally.
* **Gateway Intelligence** — a gateway classifies pending knowledge into appropriate handling categories.

---

## The Problem

Industrial environments such as underground mines contain machines that continuously generate operational data:

* Temperature
* Vibration
* Current
* Pressure
* Error conditions

Connectivity may be unreliable or unavailable.

Imagine:

> Machine A experienced a bearing failure in the past.

Later:

> Machine B develops a similar vibration and temperature pattern.

If Machine B cannot reach the cloud, it may not have access to Machine A's previous experience.

MeshMind addresses this by keeping useful machine knowledge available locally.

---

# Core Idea

Traditional cloud-dependent architecture:

```text
Machine → Internet → Cloud → AI
```

MeshMind uses an offline-first architecture:

```text
             LOCAL AI MEMORY
                    │
          ┌─────────┴─────────┐
          │                   │
      Machine A           Machine B
          │                   │
     Qdrant Edge          Qdrant Edge
          │                   │
          └──── Local Network ┘
                    │
                 Gateway
                    │
            Cloud when available
```

The key principle is:

> **The machine should remain useful even when the cloud is unavailable.**

---

# 1. Local AI Memory

Each simulated machine has its own local semantic memory powered by Qdrant Edge.

```text
Machine A
    │
    └── Qdrant Edge
           │
           ├── Previous incidents
           ├── Diagnoses
           ├── Symptoms
           └── Resolutions
```

The system uses semantic search to find relevant historical incidents.

For example, a machine may detect:

```text
Vibration ↑
Temperature ↑
Current ↑
```

It can search its local memory for previous incidents with similar characteristics.

A retrieved memory could contain:

```text
Previous Incident
-----------------
Machine: Conveyor Motor
Problem: Bearing race wear

Symptoms:
- Increased vibration
- Increased temperature

Resolution:
Bearing replacement

Technician status:
Confirmed
```

---

# 2. Local AI Explanation

MeshMind combines the current machine situation with retrieved historical knowledge.

The AI can produce an explanation such as:

> "The current sensor pattern is similar to a previous conveyor motor incident involving bearing race wear."

The flow is:

```text
Current Machine State
        │
        ▼
Local Semantic Search
        │
        ▼
Relevant Memory
        │
        ▼
AI Explanation
        │
        ▼
Technician
```

The AI provides an evidence-based recommendation. The technician remains responsible for physical inspection and confirmation.

---

# 3. Separate Machine Memory

MeshMind maintains separate Edge memory for different machines.

Example:

```text
Machine A
└── backend/data/qdrant_edge/

Machine B
└── backend/data/qdrant_edge_machine_b/
```

This allows each machine to maintain its own local memory rather than automatically sharing its entire database.

Relevant knowledge can be shared through the application's local communication workflow.

---

# 4. Gateway Intelligence

MeshMind contains a local **Gateway intelligence layer**.

The Gateway examines pending knowledge and determines how it should be handled.

It does not blindly synchronize everything.

The Gateway classifies pending records into five categories:

```text
SYNC NOW
SYNC
AGGREGATE
SKIP
LOCAL ONLY
```

### SYNC NOW

Used for concrete technician-confirmed failures.

```text
Confirmed diagnosis
        ↓
    SYNC NOW
```

### SYNC

Used for useful validated patterns.

### AGGREGATE

Used for raw sensor streams or high-volume data that should be handled as aggregated information.

### SKIP

Used for duplicate information.

### LOCAL ONLY

Used for information that should remain local.

Examples include:

* Private technician notes
* Insufficient evidence
* Missing diagnosis
* Local-only knowledge

---

# Gateway Decision Flow

```text
Pending Local Knowledge
          │
          ▼
       Gateway
          │
     ┌────┼──────────────┐
     │    │              │
     ▼    ▼              ▼
 SYNC   AGGREGATE       LOCAL ONLY
 NOW
     │
     ├───────────────┐
     ▼               ▼
   SYNC             SKIP
```

The Gateway classification is deterministic and does not require an LLM.

---

# 5. Offline-First Operation

When internet connectivity is unavailable:

```text
Internet ❌

Machine
   │
   ├── Sensor data
   ├── Anomaly detection
   ├── Local memory
   ├── Semantic search
   └── Local AI explanation
```

The machine can continue using its local knowledge.

Cloud services are not required for local memory and local retrieval.

---

# 6. Complete Prototype Flow

```text
        MACHINE A
            │
            ▼
      Previous Incident
            │
            ▼
       Qdrant Edge
            │
            ▼
       Local Memory
            │
            │
            ▼
        MACHINE B
            │
       New Anomaly
            │
            ▼
      Local Search
            │
            ▼
     Relevant Knowledge
            │
            ▼
       Local AI
            │
            ▼
      Explanation
            │
            ▼
       Technician
            │
            ▼
      New Knowledge
            │
            ▼
      Pending Queue
            │
            ▼
         Gateway
            │
     ┌──────┼─────────┐
     ▼      ▼         ▼
   SYNC   SKIP    LOCAL ONLY
```

---

# Technology Stack

### Frontend

* HTML
* CSS
* JavaScript

### Backend

* Python
* FastAPI
* Uvicorn

### Local Vector Memory

* Qdrant Edge
* FastEmbed
* `all-MiniLM-L6-v2` embeddings

### AI

* Gemini API

### Gateway

* Python-based deterministic classification layer

---

# Project Structure

```text
meshmind/
│
├── backend/
│   ├── app.py
│   ├── memory/
│   │   └── edge_memory.py
│   │
│   └── data/
│       ├── qdrant_edge/
│       └── qdrant_edge_machine_b/
│
├── css/
│   └── styles.css
│
├── js/
│   └── app.js
│
├── index.html
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

---

# Getting Started

## Prerequisites

Install:

* Python 3.x
* Git
* A Gemini API key
* Qdrant Cloud credentials if the cloud functionality is being used

The project also requires the local embedding model used by FastEmbed.

---

# 1. Clone the Repository

Clone the branch containing the current prototype:

```bash
git clone -b developing --single-branch https://github.com/Avanisharma2005/meshmind.git
cd meshmind
```

---

# 2. Install Python Dependencies

From the project root:

```bash
pip install -r requirements.txt
```

If your system uses `python` explicitly:

```bash
python -m pip install -r requirements.txt
```

---

# 3. Configure API Credentials

**Never put API keys directly into the source code or README.**

The repository contains:

```text
.env.example
```

Copy it to create your local environment file:

```bash
cp .env.example .env
```

On Windows Git Bash, the same command works.

Your `.env` should contain your own credentials:

```env
GEMINI_API_KEY=your_gemini_api_key_here

QDRANT_CLOUD_URL=your_qdrant_cloud_url_here

QDRANT_CLOUD_API_KEY=your_qdrant_cloud_api_key_here
```

### Important

The actual `.env` file must **not** be committed to GitHub.

Only `.env.example` should be shared.

Each team member should use their own credentials or credentials provided securely by the project owner.

---

# 4. Start the Backend

Open Git Bash:

```bash
cd ~/Downloads/meshmind/backend
```

Start FastAPI:

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

The backend should start at:

```text
http://127.0.0.1:8000
```

Keep this terminal running.

---

# 5. Start the Frontend

Open a second Git Bash terminal.

From the project root:

```bash
cd ~/Downloads/meshmind
```

Start the frontend server:

```bash
python -m http.server 5500
```

Open the dashboard:

```text
http://127.0.0.1:5500
```

Keep this terminal running while using the application.

---

# Running Architecture

Once both servers are running:

```text
Browser
   │
   │ :5500
   ▼
MeshMind Frontend
   │
   │ API requests
   ▼
FastAPI Backend
   │
   ├───────────────┐
   ▼               ▼
Qdrant Edge       Gemini
Local Memory      AI Explanation
   │
   ▼
Gateway
Classification
```

---

# Environment Variables

| Variable               | Purpose                     | Required                              |
| ---------------------- | --------------------------- | ------------------------------------- |
| `GEMINI_API_KEY`       | AI explanations             | Yes for Gemini features               |
| `QDRANT_CLOUD_URL`     | Qdrant Cloud endpoint       | Required only for cloud functionality |
| `QDRANT_CLOUD_API_KEY` | Qdrant Cloud authentication | Required only for cloud functionality |

The local Edge memory does not use the Qdrant Cloud API key for its local storage.

---

# Security

## Never commit secrets

Do **not** commit:

```text
.env
```

Do not put credentials in:

```text
app.py
app.js
README.md
HTML files
```

The repository should contain only:

```text
.env.example
```

with placeholder values.

Example:

```env
GEMINI_API_KEY=your_gemini_api_key_here
QDRANT_CLOUD_URL=your_qdrant_cloud_url_here
QDRANT_CLOUD_API_KEY=your_qdrant_api_key_here
```

If an API key is accidentally committed to GitHub, **revoke/rotate it immediately** and replace it with a new key.

---

# Demo Scenario

## Machine A

```text
Level 1
Conveyor Motor
```

Machine A contains a previous incident:

```text
Bearing race wear
```

with symptoms such as:

```text
Increased vibration
Increased temperature
```

and a confirmed resolution.

---

## Machine B

```text
Level 3
Conveyor Motor
```

Machine B develops a similar anomaly.

Its local memory is searched first.

The system can then use relevant available knowledge to explain the similarity.

Example:

> "The current pattern is similar to a previous conveyor motor incident involving bearing race wear."

A technician can inspect the machine and confirm or reject the recommendation.

---

# Gateway Demo

After a technician-confirmed incident is recorded, the knowledge can enter the pending queue.

The Gateway evaluates the pending records:

```text
Pending Knowledge
       │
       ▼
    Gateway
       │
       ├── SYNC NOW
       ├── SYNC
       ├── AGGREGATE
       ├── SKIP
       └── LOCAL ONLY
```

This demonstrates that the system can distinguish between information that should be shared and information that should remain local.

---

# Why MeshMind?

### Cloud-only AI

```text
Machine
   ↓
Internet
   ↓
Cloud
   ↓
AI
```

Connectivity failure can prevent access to cloud-based intelligence.

### Isolated Edge AI

```text
Machine
   ↓
Local AI
```

The machine only has access to knowledge available locally.

### MeshMind

```text
Machine
   ↓
Local Memory
   ↓
Local AI
   ↓
Gateway
   ↓
Cloud when available
```

MeshMind combines local memory with intelligent knowledge handling.

---

# Project Vision

MeshMind demonstrates the foundation of a distributed AI memory system where machines can:

1. Maintain local operational memory.
2. Search that memory semantically.
3. Use retrieved evidence to generate AI explanations.
4. Continue operating when cloud connectivity is unavailable.
5. Classify new knowledge through a Gateway.
6. Decide which information should be synchronized or remain local.

The central idea is:

> **Machines should not only generate data. They should be able to remember useful experience and intelligently manage that knowledge.**

---

# Team Setup

For a team using the repository:

```text
                    GitHub
                       │
              Clone developing branch
                       │
              ┌────────┴────────┐
              │                 │
          Teammate A         Teammate B
              │                 │
           .env              .env
              │                 │
        Own API keys       Own API keys
              │                 │
              └────────┬────────┘
                       │
                  MeshMind
```

The GitHub repository contains the application code.

**Credentials remain outside the repository.**
