"""Machine A historical semantic memory backed by an embedded Qdrant Edge shard."""

from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Any

from fastembed import TextEmbedding
from qdrant_edge import (
    CountRequest,
    Distance,
    EdgeConfig,
    EdgeShard,
    EdgeVectorParams,
    Point,
    Query,
    QueryRequest,
    UpdateOperation,
)

MACHINE_ID = "M-A-001"
VECTOR_NAME = "incident_text"
VECTOR_SIZE = 384
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
POINT_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "meshmind:M-A-001:bearing-race-wear"))
INCIDENT_TEXT = (
    "Machine M-A-001 is a conveyor motor at Level 1. Historical incident: "
    "bearing race wear caused increased vibration and increased temperature. "
    "A technician inspected the machine. Bearing replacement was required. "
    "The technician confirmed the diagnosis."
)
INCIDENT_PAYLOAD: dict[str, Any] = {
    "machine_id": MACHINE_ID,
    "location": "Level 1",
    "machine_type": "Conveyor Motor",
    "incident_type": "Bearing race wear",
    "incident_text": INCIDENT_TEXT,
    "symptoms": ["increased vibration", "increased temperature"],
    "technician_action": "Machine inspected; bearing replacement required",
    "diagnosis": "Bearing race wear",
    "confirmed": True,
}

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
SHARD_PATH = DATA_DIR / "qdrant_edge"
MODEL_CACHE_PATH = DATA_DIR / "models"


class EdgeMemory:
    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        MODEL_CACHE_PATH.mkdir(parents=True, exist_ok=True)
        # Runtime is local-only. Download/cache the model once using the README command.
        self._model = TextEmbedding(
            model_name=EMBEDDING_MODEL,
            cache_dir=str(MODEL_CACHE_PATH),
            local_files_only=True,
        )
        self._lock = threading.RLock()
        config = EdgeConfig(
            vectors={
                VECTOR_NAME: EdgeVectorParams(size=VECTOR_SIZE, distance=Distance.Cosine)
            }
        )
        SHARD_PATH.mkdir(parents=True, exist_ok=True)
        if (SHARD_PATH / "edge_config.json").exists():
            self._shard = EdgeShard.load(str(SHARD_PATH), config)
        else:
            self._shard = EdgeShard.create(str(SHARD_PATH), config)
        self._seed_once()

    def _embed(self, text: str) -> list[float]:
        vector = next(self._model.embed([text])).tolist()
        if len(vector) != VECTOR_SIZE:
            raise RuntimeError(
                f"{EMBEDDING_MODEL} returned {len(vector)} dimensions; expected {VECTOR_SIZE}"
            )
        return vector

    def _seed_once(self) -> None:
        with self._lock:
            existing = self._shard.retrieve(
                point_ids=[POINT_ID], with_payload=False, with_vector=False
            )
            if not existing:
                self._shard.update(
                    UpdateOperation.upsert_points(
                        [
                            Point(
                                id=POINT_ID,
                                vector={VECTOR_NAME: self._embed(INCIDENT_TEXT)},
                                payload=INCIDENT_PAYLOAD,
                            )
                        ]
                    )
                )
                self._shard.flush()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "status": "online",
                "backend": "Qdrant Edge",
                "machine_id": MACHINE_ID,
                "stored_memories": self._shard.count(CountRequest(exact=True)),
            }

    def get_machine_memory(self, machine_id: str) -> dict[str, Any] | None:
        if machine_id != MACHINE_ID:
            return None
        with self._lock:
            records = self._shard.retrieve(
                point_ids=[POINT_ID], with_payload=True, with_vector=False
            )
            return records[0].payload if records else None

    def search(self, query_text: str) -> dict[str, Any] | None:
        with self._lock:
            hits = self._shard.query(
                QueryRequest(
                    query=Query.Nearest(self._embed(query_text), using=VECTOR_NAME),
                    limit=1,
                    with_vector=False,
                    with_payload=True,
                )
            )
            if not hits:
                return None
            hit = hits[0]
            return {
                "matching_incident": hit.payload.get("incident_type"),
                "similarity_score": hit.score,
                "payload": hit.payload,
            }

    def close(self) -> None:
        with self._lock:
            self._shard.flush()
            self._shard.close()
