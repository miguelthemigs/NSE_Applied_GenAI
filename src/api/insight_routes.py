from importlib import import_module
from itertools import product
import json

from flask import Blueprint, Response, jsonify, request

from src.api.guards import anonymize_gate, busy_response
from src.config.themes import THEMES_LIST
from src.pipeline import jobs, model_downloads, state, status as pipeline_status

insight_bp = Blueprint("insight", __name__)
generation = import_module("src.pipeline.04_generation.service")
retrieval = import_module("src.pipeline.03_retrieval.service")
settings = import_module("src.config.settings")
llama_cpp_models = import_module("src.pipeline.04_generation.llama_cpp_models")

# Single source of the time estimate (the frontend consumes `estimate.minutes`).
SECONDS_PER_INSIGHT = 90


# Mapping: filter dimension key (sent by frontend) -> (filter_options bucket, canonical filter key)
FILTER_DIMENSION_SOURCES = {
    "academic_year": ("academic_years", "academic_year"),
    "location": ("locations", "location"),
    "programme": ("programmes", "programme"),
    "study_mode": ("study_modes", "study_mode"),
    "language": ("languages", "language"),
}


def _build_filter_grid(dimension_keys: list[str]) -> list[dict]:
    """Expand the cross-product of the requested filter dimensions."""
    if not dimension_keys:
        return []
    try:
        options_payload = retrieval.filter_options_payload()
    except Exception:
        return []
    options = options_payload.get("options") or {}

    value_lists: list[list[tuple[str, str]]] = []
    for dim_key in dimension_keys:
        mapping = FILTER_DIMENSION_SOURCES.get(dim_key)
        if not mapping:
            continue
        bucket_key, canonical_key = mapping
        values = options.get(bucket_key) or []
        if not values:
            continue
        value_lists.append([(canonical_key, str(v)) for v in values])

    if not value_lists:
        return []

    grid: list[dict] = []
    for combo in product(*value_lists):
        grid.append({key: value for key, value in combo})
    return grid


@insight_bp.route("/api/theme-summary", methods=["POST"])
def theme_summary():
    try:
        data = request.get_json(silent=True) or {}
        raw_filters = data.get("filters") or {}
        filters = {k: v for k, v in raw_filters.items() if v} if raw_filters else None
        payload = generation.generate_theme_summary(
            theme_name=data.get("theme", ""),
            theme_query=data.get("query", ""),
            llm_model=data.get("llm_model") or _running_or_default_model(),
            allow_model_download=bool(data.get("allow_model_download", False)),
            provider=data.get("provider", settings.DEFAULT_LLM_PROVIDER),
            filters=_filters_from_payload(data),
        )
        return jsonify(payload)
    except model_downloads.ModelNotDownloadedError as exc:
        return _model_missing(exc)
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except generation.LocalModelConnectionError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 503
    except Exception as exc:
        print(f"[LLAMA_CPP ERROR] {str(exc)}")
        return jsonify({"status": "error", "error": str(exc)}), 500


@insight_bp.route("/api/clear-cache", methods=["POST"])
def clear_cache():
    try:
        return jsonify(generation.clear_insight_cache())
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


@insight_bp.route("/api/clear-subtheme-cache", methods=["POST"])
def clear_subtheme_cache():
    try:
        return jsonify(generation.clear_subtheme_cache())
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


@insight_bp.route("/api/cache-status", methods=["GET"])
def cache_status():
    try:
        main = generation.load_cache()
        sub = generation.load_subtheme_cache()
        def is_filtered(key): return "::filters=" in key
        valid_main_keys = [
            key
            for key, value in main.items()
            if generation.cache_has_full_dashboard_payload(value)
        ]
        valid_sub_keys = [
            key
            for key, value in sub.items()
            if generation.cache_has_full_subtheme_payload(value, cache_key=key)
        ]
        return jsonify({
            "main_baseline": sum(1 for k in valid_main_keys if not is_filtered(k)),
            "main_filtered": sum(1 for k in valid_main_keys if is_filtered(k)),
            "subtheme_baseline": sum(1 for k in valid_sub_keys if not is_filtered(k)),
            "subtheme_filtered": sum(1 for k in valid_sub_keys if is_filtered(k)),
        })
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


def _tracked_insights(stream):
    return jobs.tracked_stream(
        "insights",
        stream,
        on_success=lambda _event: state.mark_completed("insights"),
    )


@insight_bp.route("/api/precompute-insights", methods=["POST"])
def precompute_insights():
    blocked = anonymize_gate("PRECOMPUTE-INSIGHTS")
    if blocked is not None:
        return blocked
    data = request.get_json(silent=True) or {}
    themes = data.get("themes") or [{"name": name} for name in THEMES_LIST]

    raw_max = data.get("max_documents")
    max_documents = int(raw_max) if raw_max and str(raw_max).isdigit() else None

    raw_dims = data.get("filter_dimensions") or []
    dimension_keys = [str(d) for d in raw_dims if isinstance(d, str)]
    filter_grid = _build_filter_grid(dimension_keys)
    precache_subthemes = bool(data.get("precache_subthemes", False))

    try:
        stream = _tracked_insights(generation.precompute_insights_stream(
            themes=themes,
            # The step 4 button sends model_id, like start-stream; llm_model stays accepted.
            llm_model=data.get("model_id") or data.get("llm_model") or settings.DEFAULT_LLM_MODEL,
            allow_model_download=bool(data.get("allow_model_download", False)),
            provider=data.get("provider", settings.DEFAULT_LLM_PROVIDER),
            filters=_filters_from_payload(data),
            max_documents=max_documents,
            filter_grid=filter_grid,
            precache_subthemes=precache_subthemes,
        ))
    except jobs.JobBusy as exc:
        return busy_response(exc)
    return Response(stream, mimetype="application/x-ndjson")


@insight_bp.route("/api/precompute-subthemes", methods=["POST"])
def precompute_subthemes():
    blocked = anonymize_gate("PRECOMPUTE-SUBTHEMES")
    if blocked is not None:
        return blocked
    data = request.get_json(silent=True) or {}
    themes = data.get("themes", [])
    if not themes:
        return jsonify({"error": "No themes provided"}), 400

    raw_max = data.get("max_documents")
    max_documents = int(raw_max) if raw_max and str(raw_max).isdigit() else None

    raw_dims = data.get("filter_dimensions") or []
    dimension_keys = [str(d) for d in raw_dims if isinstance(d, str)]
    filter_grid = _build_filter_grid(dimension_keys)

    try:
        stream = _tracked_insights(generation.precompute_subthemes_stream(
            themes=themes,
            llm_model=data.get("llm_model") or settings.DEFAULT_LLM_MODEL,
            allow_model_download=bool(data.get("allow_model_download", False)),
            provider=data.get("provider", settings.DEFAULT_LLM_PROVIDER),
            filters=_filters_from_payload(data),
            max_documents=max_documents,
            filter_grid=filter_grid,
        ))
    except jobs.JobBusy as exc:
        return busy_response(exc)
    return Response(stream, mimetype="application/x-ndjson")


def _valid_combos(grid: list[dict]) -> list[dict]:
    return retrieval.filter_valid_combos(grid) if grid else []


def _estimate(count: int) -> dict:
    # Integer round-half-up (matches JS Math.round); Python round() is half-to-even.
    return {"count": count, "minutes": (count * SECONDS_PER_INSIGHT + 30) // 60}


def _filtered_done(dimension_keys: list[str]) -> int:
    """Valid filtered main entries whose filter keys are exactly the requested dimensions."""
    wanted = {FILTER_DIMENSION_SOURCES[d][1] for d in dimension_keys if d in FILTER_DIMENSION_SOURCES}
    done = 0
    for key, value in pipeline_status._cache.load_cache().items():
        marker = key.find("::filters=")
        if marker < 0 or "::subquery=" in key[:marker]:
            continue
        if not pipeline_status._cache.cache_has_full_dashboard_payload(value):
            continue
        try:
            filters = json.loads(key[marker + len("::filters="):])
        except ValueError:
            continue
        if isinstance(filters, dict) and set(filters) == wanted:
            done += 1
    return done


def insight_results(filter_dimensions: list[str]) -> dict:
    """Summary-coverage rows parsed from the caches. No LLM, no network."""
    _baseline, counts = pipeline_status._insight_counts()
    active = (jobs.active_job() or {}).get("step") == "insights"

    main_done, main_total = counts["themes_done"], counts["themes_total"]
    if main_done >= main_total:
        main_state = "done"
    elif active:
        main_state = "in_progress"
    else:
        main_state = "partial" if main_done else "not_started"

    sub_done = counts["subthemes_done"]
    if active:
        sub_state = "in_progress"
    else:
        sub_state = "done" if sub_done else "not_started"

    if filter_dimensions:
        filtered_done = _filtered_done(filter_dimensions)
        filtered_total = len(_valid_combos(_build_filter_grid(filter_dimensions))) * main_total
        if filtered_total and filtered_done >= filtered_total:
            filtered_state = "done"
        elif active:
            filtered_state = "in_progress"
        else:
            filtered_state = "partial" if filtered_done else "not_started"
        estimate = _estimate(filtered_total)
    else:
        filtered_done, filtered_total, filtered_state, estimate = 0, 0, "off", None

    return {
        "rows": [
            {"kind": "main", "done": main_done, "total": main_total, "state": main_state},
            {"kind": "sub", "done": sub_done, "total": None, "state": sub_state},
            {"kind": "filtered", "done": filtered_done, "total": filtered_total, "state": filtered_state},
        ],
        "estimate": estimate,
    }


@insight_bp.route("/api/insights/results", methods=["GET"])
def insights_results():
    raw = request.args.get("filter_dimensions", "")
    dims = [d.strip() for d in raw.split(",") if d.strip()]
    try:
        return jsonify(insight_results(dims))
    except Exception as exc:
        print(f"[INSIGHT RESULTS ERROR] {exc}")
        return jsonify({"status": "error", "code": "error.backend"}), 500


@insight_bp.route("/api/precompute-preview", methods=["POST"])
def precompute_preview():
    """Return cross-product size and valid combo count for the given filter dimensions."""
    data = request.get_json(silent=True) or {}
    raw_dims = data.get("filter_dimensions") or []
    dimension_keys = [str(d) for d in raw_dims if isinstance(d, str)]
    grid = _build_filter_grid(dimension_keys)
    valid_grid = _valid_combos(grid)
    options_payload = retrieval.filter_options_payload()
    options = options_payload.get("options") or {}
    sizes = {}
    for dim_key, (bucket_key, _canonical) in FILTER_DIMENSION_SOURCES.items():
        sizes[dim_key] = len(options.get(bucket_key) or [])
    estimate = _estimate(len(valid_grid) * pipeline_status.THEMES_TOTAL) if dimension_keys else None
    return jsonify({
        "combos": len(grid),
        "valid_combos": len(valid_grid),
        "dimension_sizes": sizes,
        "estimate": estimate,
    })


@insight_bp.route("/api/llm-models", methods=["GET"])
def llm_models():
    return jsonify(
        {
            "default_provider": settings.DEFAULT_LLM_PROVIDER,
            "default_model": settings.DEFAULT_LLM_MODEL,
            "llama_cpp_base_url": settings.LLAMA_CPP_BASE_URL,
            "models": llama_cpp_models.llama_cpp_model_options(),
        }
    )


@insight_bp.route("/api/llm-models/start", methods=["POST"])
def start_llm_model():
    try:
        data = request.get_json(silent=True) or {}
        provider = data.get("provider", settings.DEFAULT_LLM_PROVIDER)
        model_name = data.get("llm_model") or settings.DEFAULT_LLM_MODEL
        client = generation.get_llm_client(provider)
        client.ensure_model_available(model_name, allow_download=True)
        return jsonify(
            {
                "status": "ready",
                "provider": provider,
                "model": llama_cpp_models.resolve_llama_cpp_model(model_name).id,
            }
        )
    except model_downloads.ModelNotDownloadedError as exc:
        return _model_missing(exc)
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        print(f"[LLAMA_CPP START ERROR] {str(exc)}")
        return jsonify({"status": "error", "error": str(exc)}), 500


@insight_bp.route("/api/llm-models/start-stream", methods=["POST"])
def start_llm_model_stream():
    """NDJSON: download events, then `stage:"load"`, then success or one clear error."""
    data = request.get_json(silent=True) or {}
    model_name = data.get("model_id") or data.get("llm_model") or settings.DEFAULT_LLM_MODEL
    try:
        llama_cpp_models.resolve_llama_cpp_model(model_name)
    except ValueError as exc:
        # Unknown id: not "model not downloaded", so not error.model_missing.
        return jsonify({"status": "error", "code": "error.backend", "error": f"Unknown model id: {model_name}. {exc}"}), 400
    try:
        # A tracked step 4 job (a download can take long), but starting the
        # model completes nothing: no on_success.
        stream = jobs.tracked_stream(
            "insights",
            generation.start_llm_stream(model_name, data.get("provider", settings.DEFAULT_LLM_PROVIDER)),
        )
    except jobs.JobBusy as exc:
        return busy_response(exc)
    return Response(stream, mimetype="application/x-ndjson")


@insight_bp.route("/api/themes-overview", methods=["GET"])
def get_themes_overview():
    filters = {}
    for key in [
        "institution",
        "academic_year",
        "location",
        "programme",
        "study_mode",
        "cohort",
        "sector",
        "language",
    ]:
        value = request.args.get(key)
        if value and value not in {"All", "all"}:
            filters[key] = value
    try:
        filter_key = json.dumps(filters, sort_keys=True)
        cached_bytes = generation.cache_store.get_overview_response(filter_key)
        if cached_bytes is not None:
            return Response(cached_bytes, mimetype="application/json")
        payload = generation.themes_overview_payload(filters)
        if payload.get("status") == "not_ready":
            return jsonify(payload)
        serialized = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        generation.cache_store.set_overview_response(filter_key, serialized)
        return Response(serialized, mimetype="application/json")
    except retrieval.ClassificationNotReady:
        return jsonify(_not_ready_overview("vectors_not_ready"))
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


def _not_ready_overview(reason: str) -> dict:
    return {
        "status": "not_ready",
        "reason": reason,
        "themes": {},
        "themes_expected": 7,
    }


def _running_or_default_model() -> str:
    """The managed llama-server's current model if one runs, else the default."""
    try:
        running = generation.llm_clients.LlamaCppClient.running_managed_model_id()
    except Exception:
        running = None
    return running or settings.DEFAULT_LLM_MODEL


def _model_missing(exc: Exception):
    """409 with error.model_missing: the files are not local and only step 4's start-stream downloads."""
    return jsonify({"status": "error", "code": "error.model_missing", "error": str(exc)}), 409


def _filters_from_payload(data: dict) -> dict:
    raw_filters = data.get("filters") or {}
    if not isinstance(raw_filters, dict):
        raw_filters = {}
    filters = {}
    for key in [
        "institution",
        "academic_year",
        "location",
        "programme",
        "study_mode",
        "cohort",
        "sector",
        "language",
    ]:
        value = raw_filters.get(key) or data.get(key)
        if value and value not in {"All", "all"}:
            filters[key] = value
    return filters
