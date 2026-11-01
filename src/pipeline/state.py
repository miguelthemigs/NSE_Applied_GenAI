"""Persistent per-step pipeline state in data/pipeline_state.json.

Shape: {"anonymize": {"completed_at", "acknowledged", "acknowledged_report"},
        "vectors": {"completed_at", "model", "documents", "tier"?},
        "rerank": {"completed_at", "skipped", "stats"},
        "insights": {"completed_at"}}
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path

from src.config.paths import PIPELINE_STATE_FILE
from src.pipeline.jobs import state_lock


ACK_RESET = {"acknowledged": False, "acknowledged_report": None}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _resolve(path: Path | None) -> Path:
    # Resolved at call time so tests can patch PIPELINE_STATE_FILE.
    return Path(path) if path is not None else PIPELINE_STATE_FILE


def load_state(path: Path | None = None) -> dict:
    try:
        data = json.loads(_resolve(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_state(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _update_step(step: str, changes: dict, path: Path | None) -> None:
    target = _resolve(path)
    with state_lock:
        data = load_state(target)
        entry = data.get(step)
        entry = dict(entry) if isinstance(entry, dict) else {}
        entry.update(changes)
        data[step] = entry
        _write_state(data, target)


def mark_completed(step: str, *, path: Path | None = None, **extra) -> None:
    """Record a successful run of `step` now (UTC) and merge `extra`.

    A new anonymisation produces a new list of possible misses, so it always
    clears an earlier review acknowledgement.
    """
    changes = {"completed_at": utc_now_iso()}
    if step == "anonymize":
        changes.update(ACK_RESET)
    changes.update(extra)
    _update_step(step, changes, path)


def reset_acknowledgement(*, path: Path | None = None) -> None:
    _update_step("anonymize", dict(ACK_RESET), path)


def acknowledge_review(report_id: str, *, path: Path | None = None) -> None:
    """Record that the user reviewed the possible misses of report `report_id`."""
    _update_step(
        "anonymize", {"acknowledged": True, "acknowledged_report": report_id}, path
    )


def set_flag(step: str, key: str, value, *, path: Path | None = None) -> None:
    _update_step(step, {key: value}, path)
