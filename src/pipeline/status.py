"""`GET /api/pipeline/status`: the single source of truth for step state.

Built from artefacts on disk, data/pipeline_state.json and the in-process jobs
registry. See "Pipeline status contract (D5)" in
docs/superpowers/specs/2026-10-31-ui-fixes-design.md for the derivation table.
"""
from datetime import datetime, timezone
from importlib import import_module
import json
from pathlib import Path

from src.config.paths import (
    ANON_CHECKPOINT_META,
    ANON_REPORT_JSON,
    ANONYMIZED_CSV_PATH,
    VECTOR_CHECKPOINT,
    VECTOR_DB_PATH,
)
from src.config.themes import LOW_INFORMATION_THEME, THEMES_LIST
from src.pipeline import jobs, state

_embedding = import_module("src.pipeline.02_embedding.service")
_cache = import_module("src.pipeline.04_generation.cache")

INSIGHT_THEMES = tuple(theme for theme in THEMES_LIST if theme != LOW_INFORMATION_THEME)
THEMES_TOTAL = len(INSIGHT_THEMES)

# The rerank stream writes "ready"; the spec contract says "completed".
RERANK_COMPLETED_STATUSES = {"ready", "completed"}

# Anonymisation report tags -> contract `by_type` categories. TITLE (honorifics
# such as "dr.") is masked as part of a person reference, so it counts as a name.
# PII covers phone numbers, e-mail addresses, IBAN and student/ID numbers.
BY_TYPE_TAGS = {
    "names": ("NAME", "TITLE"),
    "locations": ("LOCATION",),
    "numbers": ("PII",),
    "health": ("HEALTH",),
}


def vector_db_is_ready() -> bool:
    return _embedding.vector_db_ready()


def read_vector_collection() -> tuple[dict, int | None]:
    return _embedding.vector_collection_snapshot()


# -- timestamps --------------------------------------------------------------


def _parse_iso(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _mtime_iso(path: Path) -> str | None:
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(mtime, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.%fZ"
    )


def _completed_at(entry: dict, artefact: Path | None) -> str | None:
    """`completed_at` from the state file, else the artefact's mtime."""
    value = entry.get("completed_at")
    if _parse_iso(value) is not None:
        return value
    return _mtime_iso(artefact) if artefact is not None else None


def _newer(a: str | None, b: str | None) -> bool:
    """True when timestamp `a` is strictly later than `b` (both known)."""
    parsed_a, parsed_b = _parse_iso(a), _parse_iso(b)
    return parsed_a is not None and parsed_b is not None and parsed_a > parsed_b


def _vector_artefact() -> Path:
    sqlite_file = VECTOR_DB_PATH / "chroma.sqlite3"
    return sqlite_file if sqlite_file.exists() else VECTOR_DB_PATH


def _read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _entry(saved: dict, step: str) -> dict:
    entry = saved.get(step)
    return entry if isinstance(entry, dict) else {}


# -- steps -------------------------------------------------------------------


def _anonymize_summary(report: dict, acknowledged: bool) -> dict:
    verified = not bool(report.get("verification_skipped"))
    missed = report.get("missed_counts") or {}
    review = sum(int(v or 0) for v in missed.values()) if verified else 0
    tag_counts = report.get("tag_counts") or {}
    by_type = {
        category: sum(int(tag_counts.get(tag) or 0) for tag in tags)
        for category, tags in BY_TYPE_TAGS.items()
        if any(tag in tag_counts for tag in tags)
    }
    return {
        "rows": report.get("rows_processed"),
        "removed": report.get("total_entities"),
        "review": review,
        "verified": verified,
        "acknowledged": acknowledged,
        "by_type": by_type,
    }


def _anonymize_step(entry: dict, active_step: str | None) -> dict:
    report = None
    has_artefacts = ANONYMIZED_CSV_PATH.exists() and ANON_REPORT_JSON.exists()
    if has_artefacts:
        report = _read_json(ANON_REPORT_JSON)
    acknowledged = entry.get("acknowledged") is True
    summary = _anonymize_summary(report, acknowledged) if report is not None else None

    if active_step == "anonymize":
        value = "in_progress"
    elif ANON_CHECKPOINT_META.exists():
        value = "interrupted"
    elif not has_artefacts:
        value = "not_started"
    elif summary is None:
        value = "error"  # unreadable report: never treat as safe
    elif not summary["verified"]:
        value = "unverified"
    elif summary["review"] > 0 and not acknowledged:
        value = "needs_review"
    else:
        value = "done"
    return {
        "state": value,
        "completed_at": _completed_at(
            entry, ANONYMIZED_CSV_PATH if ANONYMIZED_CSV_PATH.exists() else None
        ),
        "summary": summary,
    }


def _vectors_step(
    entry: dict,
    active_step: str | None,
    *,
    ready: bool,
    metadata: dict,
    count: int | None,
    anonymize: dict,
) -> dict:
    checkpoint_payload = _embedding.vector_checkpoint_status_payload(VECTOR_CHECKPOINT)
    checkpoint = (
        {
            "processed": checkpoint_payload.get("processed_count", 0),
            "total": checkpoint_payload.get("total_docs", 0),
        }
        if checkpoint_payload.get("has_checkpoint")
        else None
    )
    completed_at = _completed_at(entry, _vector_artefact() if ready else None)
    building = metadata.get("theme_classification_status") == "building"

    if active_step == "vectors":
        value = "in_progress"
    elif building or VECTOR_CHECKPOINT.exists():
        value = "interrupted"
    elif ready:
        value = (
            "stale" if _newer(anonymize["completed_at"], completed_at) else "done"
        )
    elif anonymize["state"] != "done":
        value = "blocked"
    else:
        value = "not_started"

    summary = None
    if ready:
        documents = entry.get("documents")
        summary = {
            "documents": documents if documents is not None else count,
            "tier": entry.get("tier"),
            "model": entry.get("model") or metadata.get("embedding_model"),
        }
    return {
        "state": value,
        "completed_at": completed_at,
        "summary": summary,
        "checkpoint": checkpoint,
    }


def _rerank_step(
    entry: dict,
    active_step: str | None,
    *,
    ready: bool,
    metadata: dict,
    vectors: dict,
) -> dict:
    completed = metadata.get("theme_reranker_status") in RERANK_COMPLETED_STATUSES
    completed_at = _completed_at(entry, _vector_artefact() if completed else None)

    if active_step == "rerank":
        value = "in_progress"
    elif not ready:
        value = "blocked"
    elif completed:
        upstream_changed = vectors["state"] == "stale" or _newer(
            vectors["completed_at"], completed_at
        )
        value = "stale" if upstream_changed else "done"
    elif entry.get("skipped") is True:
        value = "skipped"
    else:
        value = "not_started"

    stats = entry.get("stats")
    return {
        "state": value,
        "completed_at": completed_at,
        "summary": stats if completed and isinstance(stats, dict) else None,
    }


def _insight_counts() -> tuple[list[dict], dict]:
    main = _cache.load_cache()
    subthemes = _cache.load_subtheme_cache()
    baseline = [
        main[theme]
        for theme in INSIGHT_THEMES
        if _cache.cache_has_full_dashboard_payload(main.get(theme))
    ]
    filtered_done = sum(
        1
        for key, value in main.items()
        if "::filters=" in key and _cache.cache_has_full_dashboard_payload(value)
    )
    subthemes_done = sum(
        1
        for key, value in subthemes.items()
        if "::filters=" not in key
        and _cache.cache_has_full_subtheme_payload(value, cache_key=key)
    )
    return baseline, {
        "themes_done": len(baseline),
        "themes_total": THEMES_TOTAL,
        "subthemes_done": subthemes_done,
        "filtered_done": filtered_done,
        # Filled in once the filter grid is part of the status (Task 15).
        "filtered_total": 0,
    }


def _insights_step(
    entry: dict,
    active_step: str | None,
    *,
    ready: bool,
    vectors: dict,
    rerank: dict,
) -> dict:
    baseline, summary = _insight_counts()
    done = summary["themes_done"]
    completed_at = _completed_at(entry, _cache.CACHE_FILE if done else None)

    if active_step == "insights":
        value = "in_progress"
    elif not ready:
        value = "blocked"
    elif done == 0:
        value = "not_started"
    elif (
        vectors["state"] == "stale"
        or rerank["state"] == "stale"
        or not all(_cache.cache_matches_generation_settings(item) for item in baseline)
    ):
        value = "stale"
    elif done < THEMES_TOTAL:
        value = "partial"
    else:
        value = "done"
    return {"state": value, "completed_at": completed_at, "summary": summary}


def build_pipeline_status() -> dict:
    saved = state.load_state()
    job = jobs.active_job()
    active_step = job["step"] if job else None
    ready = bool(vector_db_is_ready())
    metadata, count = read_vector_collection()

    anonymize = _anonymize_step(_entry(saved, "anonymize"), active_step)
    vectors = _vectors_step(
        _entry(saved, "vectors"),
        active_step,
        ready=ready,
        metadata=metadata,
        count=count,
        anonymize=anonymize,
    )
    rerank = _rerank_step(
        _entry(saved, "rerank"),
        active_step,
        ready=ready,
        metadata=metadata,
        vectors=vectors,
    )
    insights = _insights_step(
        _entry(saved, "insights"),
        active_step,
        ready=ready,
        vectors=vectors,
        rerank=rerank,
    )
    steps = {
        "anonymize": anonymize,
        "vectors": vectors,
        "rerank": rerank,
        "insights": insights,
        "query": {"state": "ready" if ready else "blocked"},
    }

    timestamps = [
        step["completed_at"]
        for step in (anonymize, vectors, rerank, insights)
        if _parse_iso(step["completed_at"]) is not None
    ]
    last_updated = max(timestamps, key=_parse_iso) if timestamps else None
    return {
        "status": "success",
        "last_updated": last_updated,
        "active_job": job,
        "steps": steps,
    }
