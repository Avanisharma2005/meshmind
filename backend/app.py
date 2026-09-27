"""Local FastAPI interface for Machine A's Qdrant Edge memory."""

from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from memory.edge_memory import EdgeMemory

memory: EdgeMemory | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global memory
    memory = EdgeMemory()
    try:
        yield
    finally:
        if memory is not None:
            memory.close()
            memory = None


app = FastAPI(
    title="MeshMind Local Memory API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class SearchRequest(BaseModel):
    machine_id: Literal["M-A-001", "M-B-002"] = "M-A-001"
    query: str = Field(min_length=1, max_length=2000)


def get_memory() -> EdgeMemory:
    if memory is None:
        raise HTTPException(status_code=503, detail="Local memory backend unavailable")
    return memory


@app.get("/api/memory/status")
def memory_status() -> dict[str, Any]:
    return get_memory().status()


@app.get("/api/memory/machine/{machine_id}")
def machine_memory(machine_id: str) -> dict[str, Any]:
    payload = get_memory().get_machine_memory(machine_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Machine memory not found")
    return payload


@app.post("/api/memory/search")
def search_memory(request: SearchRequest) -> dict[str, Any]:
    result = get_memory().search(request.machine_id, request.query)
    if result is None:
        if request.machine_id == "M-B-002":
            return {
                "machine_id": request.machine_id,
                "matching_incident": None,
                "similarity_score": None,
                "payload": None,
            }
        raise HTTPException(status_code=404, detail="No matching memory found")
    result["machine_id"] = request.machine_id
    return result
