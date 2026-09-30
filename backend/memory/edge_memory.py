"""Independent local Qdrant Edge shards for Machines A, B, and C."""

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
MACHINE_B_SHARD_PATH = DATA_DIR / "qdrant_edge_machine_b"
MACHINE_C_SHARD_PATH = DATA_DIR / "qdrant_edge_machine_c"
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
        self._config = EdgeConfig(
            vectors={VECTOR_NAME: EdgeVectorParams(size=VECTOR_SIZE, distance=Distance.Cosine)}
        )
        self._shards = {
            "M-A-001": self._open_shard(SHARD_PATH),
            "M-B-002": self._open_shard(MACHINE_B_SHARD_PATH),
            # Machine C starts empty. It receives knowledge only through the
            # explicit Cloud retrieval/import operation.
            "M-C-003": self._open_shard(MACHINE_C_SHARD_PATH),
        }
        self._seed_once()

    def _open_shard(self, path: Path) -> EdgeShard:
        path.mkdir(parents=True, exist_ok=True)
        if (path / "edge_config.json").exists():
            return EdgeShard.load(str(path), self._config)
        return EdgeShard.create(str(path), self._config)

    def _embed(self, text: str) -> list[float]:
        vector = next(self._model.embed([text])).tolist()
        if len(vector) != VECTOR_SIZE:
            raise RuntimeError(
                f"{EMBEDDING_MODEL} returned {len(vector)} dimensions; expected {VECTOR_SIZE}"
            )
        return vector

    def _seed_once(self) -> None:
        with self._lock:
            shard_a = self._shards[MACHINE_ID]
            existing = shard_a.retrieve(
                point_ids=[POINT_ID], with_payload=False, with_vector=False
            )
            if not existing:
                shard_a.update(
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
                shard_a.flush()

    def status(self) -> dict[str, Any]:
        with self._lock:
            machines = [
                {
                    "machine_id": machine_id,
                    "memory_backend": "Qdrant Edge",
                    "memory_count": shard.count(CountRequest(exact=True)),
                }
                for machine_id, shard in self._shards.items()
            ]
            return {
                "status": "online",
                "backend": "Qdrant Edge",
                # Keep the Step 5 top-level fields for existing callers.
                "machine_id": MACHINE_ID,
                "stored_memories": machines[0]["memory_count"],
                "machines": machines,
            }

    def get_machine_memory(self, machine_id: str) -> dict[str, Any] | None:
        shard = self._shards.get(machine_id)
        if shard is None or machine_id != MACHINE_ID:
            return None
        with self._lock:
            records = shard.retrieve(
                point_ids=[POINT_ID], with_payload=True, with_vector=False
            )
            return records[0].payload if records else None

    def get_memory_record(self, machine_id: str, reference_id: str) -> dict[str, Any] | None:
        """Read one validated record from only the explicitly selected local shard."""
        shard = self._shards.get(machine_id)
        if shard is None:
            return None
        with self._lock:
            records = shard.retrieve(
                point_ids=[reference_id], with_payload=True, with_vector=True
            )
            if not records:
                return None
            record = records[0]
            vector = getattr(record, "vector", None)
            if isinstance(vector, dict):
                vector = vector.get(VECTOR_NAME)
            if vector is None and isinstance(record, dict):
                vector = record.get("vector")
                if isinstance(vector, dict):
                    vector = vector.get(VECTOR_NAME)
            payload = getattr(record, "payload", None)
            if payload is None and isinstance(record, dict):
                payload = record.get("payload")
            if not isinstance(payload, dict) or not vector:
                return None
            return {"id": str(getattr(record, "id", reference_id)), "payload": payload, "vector": list(vector)}

    def search(self, machine_id: str, query_text: str) -> dict[str, Any] | None:
        shard = self._shards.get(machine_id)
        if shard is None:
            return None
        with self._lock:
            hits = shard.query(
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

    def import_cloud_knowledge(
        self, cloud_point_id: str, payload: dict[str, Any], vector: list[float]
    ) -> dict[str, Any]:
        """Import approved Cloud knowledge into Machine C only, idempotently."""
        machine_id = "M-C-003"
        if len(vector) != VECTOR_SIZE:
            raise ValueError(f"Cloud vector must contain {VECTOR_SIZE} values")
        point_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL, f"meshmind:{machine_id}:cloud:{cloud_point_id}"
        ))
        local_payload = {
            **payload,
            "machine_id": machine_id,
            "machine_type": "Conveyor Motor",
            "source": "Qdrant Cloud",
            "source_cloud_point_id": cloud_point_id,
            "imported_from_machine": payload.get("source_machine", payload.get("machine_id")),
            "technician_confirmed": True,
            "confirmed": True,
        }
        with self._lock:
            shard = self._shards[machine_id]
            existing = shard.retrieve(
                point_ids=[point_id], with_payload=False, with_vector=False
            )
            if not existing:
                shard.update(UpdateOperation.upsert_points([
                    Point(
                        id=point_id,
                        vector={VECTOR_NAME: [float(value) for value in vector]},
                        payload=local_payload,
                    )
                ]))
                shard.flush()
            return {
                "machine_id": machine_id,
                "local_memory_reference_id": point_id,
                "source_cloud_point_id": cloud_point_id,
                "memory_created": not bool(existing),
                "memory_count": shard.count(CountRequest(exact=True)),
                "payload": local_payload,
            }

    def create_validated_memory(
        self,
        diagnosis: str,
        evidence: dict[str, Any],
        original_recommendation: str,
        corrected: bool = False,
    ) -> dict[str, Any]:
        """Store a technician-validated Machine B incident in Machine B's shard only."""
        if not diagnosis.strip():
            raise ValueError("A technician diagnosis is required")
        machine_id = "M-B-002"
        machine_b = evidence["machine_b"]
        symptoms = [
            f"abnormal {sensor}" for sensor in machine_b["triggered_sensors"]
        ]
        if not symptoms:
            symptoms = ["anomaly detected"]
        query = machine_b["anomaly_query_description"]
        incident_text = (
            f"Machine {machine_id} is a {machine_b['machine_type']}. "
            f"Technician-validated incident: {diagnosis.strip()}. "
            f"Symptoms: {', '.join(symptoms)}. "
            f"Sensor readings: temperature {machine_b['current_temperature']} C, "
            f"vibration {machine_b['current_vibration']} mm/s, "
            f"current {machine_b['current_current']} A, "
            f"pressure {machine_b['current_pressure']} bar. "
            f"Anomaly query: {query}"
        )
        point_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"meshmind:{machine_id}:{query}:{diagnosis.strip().casefold()}",
        ))
        payload: dict[str, Any] = {
            "machine_id": machine_id,
            "machine_type": machine_b["machine_type"],
            "incident_type": diagnosis.strip(),
            "diagnosis": diagnosis.strip(),
            "incident_text": incident_text,
            "symptoms": symptoms,
            "technician_action": (
                f"Technician corrected the AI recommendation and validated: {diagnosis.strip()}"
                if corrected
                else f"Technician confirmed diagnosis: {diagnosis.strip()}"
            ),
            "technician_confirmed": True,
            "confirmed": True,
            "validation_source": "technician",
            "ai_recommendation": original_recommendation,
            "ai_recommendation_rejected": corrected,
        }
        with self._lock:
            shard_b = self._shards[machine_id]
            existing = shard_b.retrieve(
                point_ids=[point_id], with_payload=True, with_vector=False
            )
            if not existing:
                shard_b.update(
                    UpdateOperation.upsert_points(
                        [Point(
                            id=point_id,
                            vector={VECTOR_NAME: self._embed(incident_text)},
                            payload=payload,
                        )]
                    )
                )
                shard_b.flush()
            return {
                "machine_id": machine_id,
                "incident_type": diagnosis.strip(),
                "local_memory_reference_id": point_id,
                "memory_created": not bool(existing),
                "technician_confirmed": True,
                "memory_count": shard_b.count(CountRequest(exact=True)),
            }

    def close(self) -> None:
        with self._lock:
            for shard in self._shards.values():
                shard.flush()
                shard.close()
