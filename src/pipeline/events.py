"""Machine-readable NDJSON stream events shared by the pipeline services."""
import json

STAGES = ("download", "load", "read", "process", "save")
STATUSES = ("progress", "success", "error")
ERROR_CODES = (
    "error.backend",
    "error.model_missing",
    "error.download_failed",
    "error.llm_unavailable",
    "error.no_data",
)


def stream_event(
    status: str,
    *,
    stage: str | None = None,
    code: str | None = None,
    params: dict | None = None,
    message: str = "",
    progress: float | None = None,
    **extra,
) -> str:
    """Return one NDJSON line. Keys whose value is None (or an empty message) are omitted."""
    if status not in STATUSES:
        raise ValueError(f"Unknown status: {status!r}")
    if stage is not None and stage not in STAGES:
        raise ValueError(f"Unknown stage: {stage!r}")
    payload = {
        "status": status,
        "stage": stage,
        "code": code,
        "params": params,
        "message": message or None,
        "progress": progress,
        **extra,
    }
    return json.dumps({k: v for k, v in payload.items() if v is not None}) + "\n"
