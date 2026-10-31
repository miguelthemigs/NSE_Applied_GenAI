"""Quick / Balanced / Most thorough model tiers (spec D8).

A tier names one embedding model (step 2) and one generation model (step 4).
Technical ids stay behind the UI's Advanced disclosure.
"""
from __future__ import annotations

from importlib import import_module
import os
import re
import threading
import time

TIERS: dict[str, dict[str, str]] = {
    "quick": {
        "vectors": "Octen/Octen-Embedding-0.6B",
        "insights": "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL",
    },
    "balanced": {
        "vectors": "Octen/Octen-Embedding-0.6B",
        "insights": "unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL",
    },
    "thorough": {
        "vectors": "Octen/Octen-Embedding-4B",
        "insights": "unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL",
    },
}
DEFAULT_TIER = "balanced"
STEPS = ("vectors", "insights")

HUB_TIMEOUT_SECONDS = 3
FAILURE_RETRY_SECONDS = 60
# Weights files that mark an embedding model as present on this computer.
EMBEDDING_MAIN_FILES = ("model.safetensors", "model.safetensors.index.json")

_size_lock = threading.Lock()
_size_cache: dict[str, tuple[int | None, float]] = {}


def _reset_size_cache() -> None:
    with _size_lock:
        _size_cache.clear()


def tier_for_model(step: str, model_id: str | None) -> str | None:
    """The tier whose model for `step` is `model_id`, else None.

    Quick and Balanced share one embedding model; that ambiguous id reports
    the default tier, because the request carries only the model id.
    """
    ordered = [DEFAULT_TIER, *(t for t in TIERS if t != DEFAULT_TIER)]
    for tier in ordered:
        ids = TIERS[tier]
        if ids.get(step) is not None and ids[step] == model_id:
            return tier
    return None


def _llama():
    return import_module("src.pipeline.04_generation.llama_cpp_models")


def _embeddings():
    return import_module("src.pipeline.02_embedding.embedding_models")


def _offline() -> bool:
    return os.environ.get("HF_HUB_OFFLINE", "").strip().lower() in {"1", "true", "yes"}


def _parse_gb(label: str) -> int | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*GB", label or "")
    return round(float(match.group(1)) * 1e9) if match else None


def _hub_size(repo_id: str) -> int | None:
    """Sum of file sizes from the Hub; memoised, None offline or on any error."""
    if _offline():
        return None
    now = time.monotonic()
    with _size_lock:
        hit = _size_cache.get(repo_id)
    if hit and (hit[0] is not None or now - hit[1] < FAILURE_RETRY_SECONDS):
        return hit[0]
    try:
        from huggingface_hub import HfApi

        info = HfApi().model_info(repo_id, files_metadata=True, timeout=HUB_TIMEOUT_SECONDS)
        sizes = [s.size for s in (info.siblings or []) if isinstance(getattr(s, "size", None), int)]
        size = sum(sizes) or None
    except Exception:
        size = None
    with _size_lock:
        _size_cache[repo_id] = (size, now)
    return size


def _size_bytes(step: str, model_id: str) -> int | None:
    try:
        if step == "insights":
            return _parse_gb(_llama().resolve_llama_cpp_model(model_id).size)
        return _hub_size(model_id)
    except Exception:
        return None


def _is_cached(step: str, model_id: str) -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache

        if step == "insights":
            model = _llama().resolve_llama_cpp_model(model_id)
            candidates = [(model.repo_id, model.filename)]
        else:
            candidates = [(model_id, name) for name in EMBEDDING_MAIN_FILES]
        return any(isinstance(try_to_load_from_cache(repo, name), str) for repo, name in candidates)
    except Exception:
        return False


def model_tiers_payload() -> dict:
    tiers = [
        {
            "tier": tier,
            "step": step,
            "model_id": ids[step],
            "size_bytes": _size_bytes(step, ids[step]),
            "cached": _is_cached(step, ids[step]),
        }
        for step in STEPS
        for tier, ids in TIERS.items()
    ]
    return {
        "tiers": tiers,
        "advanced": {
            "vectors": list(_embeddings().AVAILABLE_EMBEDDING_MODELS),
            "insights": [m.id for m in _llama().GEMMA_LLAMA_CPP_MODELS],
        },
    }
