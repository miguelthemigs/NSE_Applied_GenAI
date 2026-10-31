from importlib import import_module
import json
from datetime import datetime, timezone

from src.config.model_tiers import tier_for_model
from src.config.themes import LOW_INFORMATION_THEME
from src.pipeline import model_downloads
from src.pipeline.events import stream_event
from src.config.settings import (
    DEFAULT_LLM_MODEL,
    DEFAULT_LLM_PROVIDER,
    HIERARCHICAL_RAG_BATCH_DOCUMENTS,
    HIERARCHICAL_RAG_MAX_DOCUMENTS,
    INSIGHT_CACHE_VERSION,
    LLM_CONTEXT_DOCUMENTS,
)

cache_store = import_module("src.pipeline.04_generation.cache")
insight_metrics = import_module("src.pipeline.04_generation.insight_metrics")
llm_clients = import_module("src.pipeline.04_generation.llm_clients")
llama_cpp_models = import_module("src.pipeline.04_generation.llama_cpp_models")
prompts = import_module("src.pipeline.04_generation.prompts")
retrieval = import_module("src.pipeline.03_retrieval.service")
LocalModelConnectionError = llm_clients.LocalModelConnectionError
get_llm_client = llm_clients.get_llm_client

load_cache = cache_store.load_cache
save_cache = cache_store.save_cache
clear_insight_cache = cache_store.clear_insight_cache
clear_subtheme_cache = cache_store.clear_subtheme_cache
cache_matches_generation_settings = cache_store.cache_matches_generation_settings
cache_has_full_dashboard_payload = cache_store.cache_has_full_dashboard_payload
cache_has_full_subtheme_payload = cache_store.cache_has_full_subtheme_payload
load_subtheme_cache = cache_store.load_subtheme_cache
save_subtheme_cache = cache_store.save_subtheme_cache
clear_subtheme_cache = cache_store.clear_subtheme_cache

HIERARCHICAL_RAG_STRATEGY = "semantic_theme_map_reduce_v2"
SUBTHEME_MANIFEST_FIELD = "subtheme_manifest"
MAX_SUBTHEMES = 5


def _reraise_fatal(exc: Exception) -> None:
    """Per-theme handlers skip and continue; a missing model or a lost
    llama-server must end the run instead (every next theme would fail too)."""
    if isinstance(exc, (model_downloads.ModelNotDownloadedError, LocalModelConnectionError)):
        raise exc


def _nothing_generated_event(attempted: int) -> str:
    """A run that tried and wrote no summary at all is a failure, not success."""
    return stream_event(
        "error",
        code="error.backend",
        message=f"No summary could be written: all {attempted} attempts failed (see the skipped items above).",
    )


def _ensure_llm_eligible_theme(theme_name: str) -> None:
    if theme_name == LOW_INFORMATION_THEME:
        raise ValueError(
            f"{LOW_INFORMATION_THEME} responses are excluded from LLM generation."
        )


def _model_generation_settings(provider: str, llm_model: str) -> dict | None:
    selected = (provider or DEFAULT_LLM_PROVIDER).strip().lower()
    if selected not in {"llama.cpp", "llamacpp", "llama-cpp"}:
        return None
    return llama_cpp_models.resolve_llama_cpp_model(llm_model).generation.to_dict()


def _stamped(entry: dict) -> dict:
    """Add a UTC ISO `generated_at` to a NEW cache entry (old entries read as null)."""
    entry["generated_at"] = datetime.now(timezone.utc).isoformat()
    return entry


def _normalized_filters(filters: dict | None) -> dict:
    return {
        str(key): str(value)
        for key, value in sorted((filters or {}).items())
        if value is not None and str(value).strip() and str(value).lower() != "all"
    }


def _cache_key(theme_name: str, filters: dict | None = None, theme_query: str | None = None) -> str:
    normalized = _normalized_filters(filters)
    key = theme_name
    if theme_query and theme_query != theme_name:
        key = f"{theme_name}::subquery={theme_query}"
    if not normalized:
        return key
    filters_json = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return f"{key}::filters={filters_json}"


def _cache_filters_match(cached_data: dict | None, filters: dict | None) -> bool:
    if not isinstance(cached_data, dict):
        return False
    return _normalized_filters(cached_data.get("filters_applied")) == _normalized_filters(
        filters
    )


def _evidence_id(index: int) -> str:
    return f"E{index + 1:04d}"


def _with_evidence_ids(evidence: list[dict]) -> list[dict]:
    return [
        {
            **item,
            "evidence_id": str(item.get("evidence_id") or _evidence_id(index)),
        }
        for index, item in enumerate(evidence)
    ]


def _clean_string_list(values) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned = []
    seen = set()
    for value in values:
        if isinstance(value, dict):
            value = value.get("name") or value.get("subtheme") or value.get("label")
        text = str(value or "").strip()
        if text and text not in seen:
            cleaned.append(text)
            seen.add(text)
    return cleaned


def _normalize_subtheme_manifest(parsed: dict, selected: dict) -> tuple[list[str], list[dict]]:
    valid_ids = {
        str(item.get("evidence_id"))
        for item in selected.get("all_evidence", [])
        if item.get("evidence_id")
    }
    raw_subthemes = parsed.get("subthemes") or []
    raw_manifest = parsed.get(SUBTHEME_MANIFEST_FIELD) or []
    labels = _clean_string_list(raw_subthemes)
    manifest_by_name: dict[str, dict] = {}

    def upsert_manifest_item(item: dict) -> None:
        if not isinstance(item, dict):
            return
        name = str(
            item.get("name") or item.get("subtheme") or item.get("label") or ""
        ).strip()
        if not name:
            return
        if name not in labels:
            labels.append(name)
        evidence_ids = [
            str(evidence_id).strip()
            for evidence_id in (item.get("evidence_ids") or [])
            if str(evidence_id).strip() in valid_ids
        ]
        existing = manifest_by_name.setdefault(
            name,
            {
                "name": name,
                "description": str(item.get("description") or "").strip(),
                "evidence_ids": [],
            },
        )
        if not existing["description"]:
            existing["description"] = str(item.get("description") or "").strip()
        for evidence_id in evidence_ids:
            if evidence_id not in existing["evidence_ids"]:
                existing["evidence_ids"].append(evidence_id)

    for item in raw_manifest:
        upsert_manifest_item(item)

    for item in raw_subthemes:
        upsert_manifest_item(item)

    for label in labels:
        manifest_by_name.setdefault(
            label,
            {"name": label, "description": "", "evidence_ids": []},
        )

    evidence_backed_labels = [
        label
        for label in labels
        if manifest_by_name.get(label, {}).get("evidence_ids")
    ]
    if evidence_backed_labels:
        labels = evidence_backed_labels

    labels = labels[:MAX_SUBTHEMES]
    ordered_manifest = [manifest_by_name[label] for label in labels if label in manifest_by_name]
    return labels, ordered_manifest


def _manifest_for_subtheme(main_entry: dict, subtheme: str) -> dict:
    target = str(subtheme or "").strip()
    for item in main_entry.get(SUBTHEME_MANIFEST_FIELD) or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("name") or "").strip() == target:
            return item
    return {"name": target, "description": "", "evidence_ids": []}


def _subthemes_for_precompute(main_entry: dict) -> list[str]:
    manifest_subthemes = []
    for item in main_entry.get(SUBTHEME_MANIFEST_FIELD) or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        evidence_ids = [
            str(evidence_id).strip()
            for evidence_id in (item.get("evidence_ids") or [])
            if str(evidence_id).strip()
        ]
        if name and evidence_ids:
            manifest_subthemes.append(name)

    if manifest_subthemes:
        return _clean_string_list(manifest_subthemes)[:MAX_SUBTHEMES]
    return _clean_string_list(main_entry.get("subthemes") or [])[:MAX_SUBTHEMES]


def _sanitize_cached_subthemes(cached_data: dict) -> dict:
    if not isinstance(cached_data, dict):
        return cached_data

    subthemes = _subthemes_for_precompute(cached_data)
    if not subthemes:
        return cached_data

    sanitized = dict(cached_data)
    sanitized["subthemes"] = subthemes

    manifest_by_name = {
        str(item.get("name") or "").strip(): item
        for item in cached_data.get(SUBTHEME_MANIFEST_FIELD) or []
        if isinstance(item, dict)
    }
    sanitized[SUBTHEME_MANIFEST_FIELD] = [
        manifest_by_name.get(
            subtheme,
            {"name": subtheme, "description": "", "evidence_ids": []},
        )
        for subtheme in subthemes
    ]

    mention_rows = [
        dict(row)
        for row in cached_data.get("subtheme_mentions") or []
        if isinstance(row, dict) and str(row.get("subtheme") or "").strip() in subthemes
    ]
    total_mentions = sum(int(row.get("mentions") or 0) for row in mention_rows)
    if total_mentions > 0:
        for row in mention_rows:
            row["percentage"] = int(
                round((int(row.get("mentions") or 0) / total_mentions) * 100)
            )
    sanitized["subtheme_mentions"] = mention_rows

    return sanitized


def _cached_dashboard_response(
    cache: dict,
    theme_name: str,
    *,
    filters: dict | None = None,
    llm_provider: str | None = None,
    llm_model: str | None = None,
    llm_generation_settings: dict | None = None,
    match_llm_identity: bool = False,
) -> dict | None:
    cached_data = cache.get(_cache_key(theme_name, filters))
    if not cache_has_full_dashboard_payload(
        cached_data,
        llm_provider=llm_provider,
        llm_model=llm_model,
        llm_generation_settings=llm_generation_settings,
        match_llm_identity=match_llm_identity,
    ):
        return None
    response_data = dict(_sanitize_cached_subthemes(cached_data) or {})
    response_data["status"] = "success"
    response_data.setdefault("theme", theme_name)
    response_data.setdefault("query", theme_name)
    response_data.setdefault("is_subtheme", False)
    response_data.setdefault("filters_applied", filters)
    return response_data


def _cached_subtheme_response(
    cache: dict,
    theme_name: str,
    theme_query: str,
    *,
    filters: dict | None = None,
    llm_provider: str | None = None,
    llm_model: str | None = None,
    llm_generation_settings: dict | None = None,
    match_llm_identity: bool = False,
) -> dict | None:
    cache_key = _cache_key(theme_name, filters, theme_query)
    cached_data = cache.get(cache_key)
    if not cache_has_full_subtheme_payload(
        cached_data,
        llm_provider=llm_provider,
        llm_model=llm_model,
        llm_generation_settings=llm_generation_settings,
        match_llm_identity=match_llm_identity,
        cache_key=cache_key,
    ):
        return None
    response_data = dict(_sanitize_cached_subthemes(cached_data) or {})
    response_data["status"] = "success"
    response_data.setdefault("theme", theme_name)
    response_data["query"] = str(response_data.get("query") or theme_query)
    response_data["is_subtheme"] = True
    response_data.setdefault("filters_applied", filters)
    return response_data


def _select_theme_documents(
    collection,
    theme_name: str,
    *,
    filters: dict | None = None,
    theme_query: str | None = None,
    evidence_ids: list[str] | None = None,
    max_documents: int | None = None,
):
    cap = max_documents if max_documents and max_documents > 0 else HIERARCHICAL_RAG_MAX_DOCUMENTS
    is_subtheme = bool(theme_query and theme_query != theme_name)
    collected = retrieval.collect_theme_documents(
        collection,
        theme_name,
        filters=_normalized_filters(filters),
    )
    all_evidence = _with_evidence_ids(collected["evidence"])
    if is_subtheme:
        requested_ids = {
            str(evidence_id).strip()
            for evidence_id in (evidence_ids or [])
            if str(evidence_id).strip()
        }
        if requested_ids:
            all_evidence = [
                item
                for item in all_evidence
                if str(item.get("evidence_id")) in requested_ids
            ]
        else:
            all_evidence = [
                {**item, "evidence_type": "subtheme_candidate"}
                for item in all_evidence
            ]
        collected = {
            **collected,
            "frequency": (
                round(
                    (len(all_evidence) / collected["total_filtered_documents"]) * 100
                )
                if collected["total_filtered_documents"]
                else 0
            ),
            "vector_relevant_count": len(all_evidence),
        }
    selected_evidence = all_evidence[:cap] if cap > 0 else all_evidence
    all_docs = [evidence["document"] for evidence in all_evidence]
    selected_docs = [evidence["document"] for evidence in selected_evidence]
    return {
        "frequency": collected["frequency"],
        "vector_relevant_count": collected["vector_relevant_count"],
        "total_filtered_documents": collected["total_filtered_documents"],
        "relevant_docs": selected_docs,
        "relevant_evidence": selected_evidence,
        "all_evidence": all_evidence,
        "all_docs": all_docs,
        "source_document_count": len(all_docs),
        "analyzed_document_count": len(selected_docs),
        "definite_evidence_count": sum(
            evidence["evidence_type"] == "definite"
            for evidence in all_evidence
        ),
        "ambiguous_evidence_count": sum(
            evidence["evidence_type"] == "ambiguous"
            for evidence in all_evidence
        ),
        "classification_metadata": retrieval.classification_cache_metadata(
            collection
        ),
    }


def _document_batches(docs: list) -> list[list]:
    batch_size = max(1, HIERARCHICAL_RAG_BATCH_DOCUMENTS)
    return [docs[i : i + batch_size] for i in range(0, len(docs), batch_size)]


def _generate_hierarchical_json(
    client,
    llm_model: str,
    theme_name: str,
    evidence: list[dict],
    *,
    theme_query: str | None = None,
) -> dict:
    is_subtheme = bool(theme_query and theme_query != theme_name)
    batches = _document_batches(evidence)
    if len(batches) <= 1:
        if is_subtheme:
            prompt = prompts.build_subtheme_prompt(
                theme_name,
                str(theme_query),
                evidence,
            )
        else:
            prompt = prompts.build_prompt(
                theme_name,
                evidence,
            )
        return prompts.parse_llm_json(client.generate_json(llm_model, prompt))

    batch_summaries = []
    for i, batch in enumerate(batches, start=1):
        if is_subtheme:
            prompt = prompts.build_subtheme_batch_summary_prompt(
                theme_name,
                str(theme_query),
                batch,
                batch_number=i,
                total_batches=len(batches),
            )
        else:
            prompt = prompts.build_batch_summary_prompt(
                theme_name,
                batch,
                batch_number=i,
                total_batches=len(batches),
            )
        parsed = prompts.parse_llm_json(
            client.generate_json(llm_model, prompt)
        )
        parsed["batch_number"] = i
        parsed["source_document_count"] = len(batch)
        batch_summaries.append(parsed)

    if is_subtheme:
        reduce_prompt = prompts.build_subtheme_reduce_prompt(
            theme_name,
            str(theme_query),
            batch_summaries,
            source_document_count=len(evidence),
        )
    else:
        reduce_prompt = prompts.build_reduce_prompt(
            theme_name,
            batch_summaries,
            source_document_count=len(evidence),
        )
    return prompts.parse_llm_json(
        client.generate_json(llm_model, reduce_prompt)
    )


def _generate_theme_payload(
    *,
    client,
    collection,
    theme_name: str,
    filters: dict,
    provider: str,
    llm_model: str,
    llm_generation_settings: dict | None,
    theme_query: str | None = None,
    evidence_ids: list[str] | None = None,
    max_documents: int | None = None,
) -> dict:
    _ensure_llm_eligible_theme(theme_name)
    selected = _select_theme_documents(
        collection,
        theme_name,
        filters=filters,
        theme_query=theme_query,
        evidence_ids=evidence_ids,
        max_documents=max_documents,
    )
    relevant_evidence = selected["relevant_evidence"]
    if not relevant_evidence:
        return _empty_theme_payload(
            theme_name,
            selected,
            filters=filters,
            provider=provider,
            llm_model=llm_model,
            llm_generation_settings=llm_generation_settings,
            theme_query=theme_query,
        )

    parsed = _generate_hierarchical_json(
        client,
        llm_model,
        theme_name,
        relevant_evidence,
        theme_query=theme_query,
    )
    return _theme_payload_from_parsed(
        theme_name,
        selected,
        parsed,
        filters=filters,
        provider=provider,
        llm_model=llm_model,
        llm_generation_settings=llm_generation_settings,
        theme_query=theme_query,
    )


def generate_theme_summary(
    *,
    theme_name: str,
    theme_query: str,
    llm_model: str = DEFAULT_LLM_MODEL,
    allow_model_download: bool = False,
    provider: str = DEFAULT_LLM_PROVIDER,
    filters: dict | None = None,
) -> dict:
    llm_model = str(llm_model or DEFAULT_LLM_MODEL).strip()
    provider = str(provider or DEFAULT_LLM_PROVIDER).strip()
    filters = _normalized_filters(filters)
    llm_generation_settings = _model_generation_settings(provider, llm_model)
    is_subquery = theme_query and theme_query != theme_name
    if not theme_name and not theme_query:
        raise ValueError("No query provided")
    _ensure_llm_eligible_theme(theme_name)

    cache = load_cache()
    cache_key = _cache_key(theme_name, filters, theme_query if is_subquery else None)
    if not is_subquery:
        cached_response = _cached_dashboard_response(
            cache,
            theme_name,
            filters=filters,
            llm_provider=provider,
            llm_model=llm_model,
            llm_generation_settings=llm_generation_settings,
            match_llm_identity=True,
        )
        if cached_response is not None:
            print(f"[LLM] Returning cached summary for: {theme_name}")
            return cached_response
    elif is_subquery:
        subtheme_cache = load_subtheme_cache()
        cached_response = _cached_subtheme_response(
            subtheme_cache,
            theme_name,
            theme_query,
            filters=filters,
            llm_provider=provider,
            llm_model=llm_model,
            llm_generation_settings=llm_generation_settings,
            match_llm_identity=True,
        )
        if cached_response is not None:
            print(f"[LLM] Returning cached subquery summary for: {theme_query}")
            return cached_response
        print(f"[LLM] Subtheme not pre-cached: {theme_query}")
        return {
            "status": "not_cached",
            "theme": theme_name,
            "query": theme_query,
            "message": "Subtheme insights not generated yet. Run the subtheme precompute first.",
        }

    if cache_key in cache and not is_subquery:
        print(
            f"[LLM] Cached summary for {theme_name} is missing current "
            "dashboard fields; regenerating."
        )

    collection = retrieval.get_collection()
    client = get_llm_client(provider)
    try:
        label = theme_query if is_subquery else theme_name
        print(f"[LLM] Cache miss - generating summary for: {label}")
        client.ensure_model_available(llm_model, allow_download=allow_model_download)

        response_data = _generate_theme_payload(
            client=client,
            collection=collection,
            theme_name=theme_name,
            filters=filters,
            provider=provider,
            llm_model=llm_model,
            llm_generation_settings=llm_generation_settings,
            theme_query=theme_query if is_subquery else None,
        )
        print(
            f"[LLM] Hierarchical RAG analyzed "
            f"{response_data['hierarchical_document_count']} / "
            f"{response_data['document_count']} semantically assigned docs for "
            f"{theme_name}."
        )

        cache[cache_key] = _stamped(response_data)
        save_cache(cache)
        print(f"[LLM] Saved summary to cache for: {theme_name}")

        return response_data
    finally:
        client.unload(llm_model)


def _empty_theme_payload(
    theme_name: str,
    selected: dict,
    *,
    filters: dict,
    provider: str,
    llm_model: str,
    llm_generation_settings: dict | None,
    theme_query: str | None = None,
) -> dict:
    is_subtheme = bool(theme_query and theme_query != theme_name)
    return {
        "status": "success",
        "theme": theme_name,
        "query": theme_query if is_subtheme else theme_name,
        "is_subtheme": is_subtheme,
        "frequency": selected["frequency"],
        "document_count": selected["source_document_count"],
        "vector_relevant_count": selected["vector_relevant_count"],
        "total_filtered_documents": selected["total_filtered_documents"],
        "llm_document_count": 0,
        "hierarchical_document_count": 0,
        "hierarchical_batch_documents": HIERARCHICAL_RAG_BATCH_DOCUMENTS,
        "rag_strategy": HIERARCHICAL_RAG_STRATEGY,
        "filters_applied": filters,
        "cache_version": INSIGHT_CACHE_VERSION,
        "llm_context_documents": LLM_CONTEXT_DOCUMENTS,
        "llm_provider": provider,
        "llm_model": llm_model,
        "llm_generation_settings": llm_generation_settings,
        "reranker": selected["classification_metadata"]["theme_reranker_model"],
        "definite_evidence_count": selected["definite_evidence_count"],
        "ambiguous_evidence_count": selected["ambiguous_evidence_count"],
        **selected["classification_metadata"],
        "summary": "No responses were semantically assigned to this theme.",
        "positive_comments": [],
        "critical_comments": [],
        "student_suggestions": [],
        "subthemes": [],
        SUBTHEME_MANIFEST_FIELD: [],
        "subtheme_mentions": [],
        "quotes": [],
    }


def _theme_payload_from_parsed(
    theme_name: str,
    selected: dict,
    parsed: dict,
    *,
    filters: dict,
    provider: str,
    llm_model: str,
    llm_generation_settings: dict | None,
    theme_query: str | None = None,
) -> dict:
    is_subtheme = bool(theme_query and theme_query != theme_name)
    relevant_docs = selected["relevant_docs"]
    all_docs = selected.get("all_docs", relevant_docs)
    quotes = [doc for doc in all_docs if len(doc.strip()) > 1]
    subthemes, subtheme_manifest = _normalize_subtheme_manifest(parsed, selected)
    return {
        "status": "success",
        "theme": theme_name,
        "query": theme_query if is_subtheme else theme_name,
        "is_subtheme": is_subtheme,
        "frequency": selected["frequency"],
        "document_count": selected["source_document_count"],
        "vector_relevant_count": selected["vector_relevant_count"],
        "total_filtered_documents": selected["total_filtered_documents"],
        "llm_document_count": selected["analyzed_document_count"],
        "hierarchical_document_count": selected["analyzed_document_count"],
        "hierarchical_batch_documents": HIERARCHICAL_RAG_BATCH_DOCUMENTS,
        "rag_strategy": HIERARCHICAL_RAG_STRATEGY,
        "filters_applied": filters,
        "cache_version": INSIGHT_CACHE_VERSION,
        "llm_context_documents": LLM_CONTEXT_DOCUMENTS,
        "llm_provider": provider,
        "llm_model": llm_model,
        "llm_generation_settings": llm_generation_settings,
        "reranker": selected["classification_metadata"]["theme_reranker_model"],
        "definite_evidence_count": selected["definite_evidence_count"],
        "ambiguous_evidence_count": selected["ambiguous_evidence_count"],
        **selected["classification_metadata"],
        "summary": parsed.get("summary", "Summary could not be parsed."),
        "positive_comments": parsed.get("positive_comments", [])[:3],
        "critical_comments": parsed.get("critical_comments", [])[:3],
        "student_suggestions": parsed.get("student_suggestions", [])[:3],
        "subthemes": subthemes,
        SUBTHEME_MANIFEST_FIELD: subtheme_manifest,
        "subtheme_mentions": insight_metrics.subtheme_mention_rows(subthemes, all_docs),
        "quotes": quotes,
    }


def precompute_insights_stream(
    *,
    themes: list[dict],
    llm_model: str = DEFAULT_LLM_MODEL,
    allow_model_download: bool = False,
    provider: str = DEFAULT_LLM_PROVIDER,
    filters: dict | None = None,
    max_documents: int | None = None,
    filter_grid: list[dict] | None = None,
    precache_subthemes: bool = False,
):
    themes = [
        theme
        for theme in themes
        if theme.get("name") != LOW_INFORMATION_THEME
    ]
    llm_model = str(llm_model or DEFAULT_LLM_MODEL).strip()
    provider = str(provider or DEFAULT_LLM_PROVIDER).strip()
    filters = _normalized_filters(filters)
    normalized_grid = [_normalized_filters(combo) for combo in (filter_grid or [])]
    # Drop combos equal to the baseline so we don't duplicate work
    baseline_key = json.dumps(filters, sort_keys=True)
    normalized_grid = [
        combo for combo in normalized_grid
        if json.dumps(combo, sort_keys=True) != baseline_key
    ]
    client = None
    attempted = generated = 0
    try:
        llm_generation_settings = _model_generation_settings(provider, llm_model)
        cache = load_cache()
        collection = None
        cached_theme_names = {
            theme.get("name")
            for theme in themes
            if _cached_dashboard_response(
                cache,
                theme.get("name"),
                filters=filters,
                llm_provider=provider,
                llm_model=llm_model,
                llm_generation_settings=llm_generation_settings,
                match_llm_identity=True,
            )
            is not None
        }
        missing_theme_names = [
            theme.get("name")
            for theme in themes
            if theme.get("name") not in cached_theme_names
        ]
        baseline_work = [
            theme
            for theme in themes
            if theme.get("name") in set(missing_theme_names)
        ]
        if (
            len(cached_theme_names) == len(themes)
            and not normalized_grid
            and not precache_subthemes
        ):
            for i, theme in enumerate(themes):
                theme_name = theme.get("name")
                yield stream_event("progress", stage="read", message=f"Loaded cached insights for {theme_name}", progress=int(((i + 1) / len(themes)) * 100), theme=theme_name)
            yield stream_event("success", message="All insights already cached!", progress=100)
            return

        yield stream_event("progress", stage="read", message=f"Cache plan: {len(cached_theme_names)} cached, "
                    f"{len(missing_theme_names)} to generate"
                    + (
                        f" ({', '.join(missing_theme_names)})"
                        if missing_theme_names
                        else ""
                    ), progress=0)

        # Filter grid upfront with one bulk metadata fetch — avoids per-combo ChromaDB calls later.
        valid_grid = retrieval.filter_valid_combos(normalized_grid) if normalized_grid else []

        # Total steps across baseline + every valid grid combo, so progress never resets.
        total_steps = max(1, len(baseline_work) + (len(themes) * len(valid_grid)))

        def _pct(step: float) -> int:
            return min(99, int((step / total_steps) * 100))

        for i, theme in enumerate(baseline_work):
            theme_name = theme.get("name")

            yield stream_event("progress", stage="process", message=f"Generating missing theme {i + 1}/{len(baseline_work)}: "
                        f"{theme_name}", progress=_pct(i), theme=theme_name)

            yield stream_event("progress", stage="process", message=f"{llm_model} is generating hierarchical summary for "
                        f"{theme_name}...", progress=_pct(i + 0.5), theme=theme_name)

            attempted += 1
            try:
                if client is None:
                    yield stream_event("progress", stage="load", message=f"Checking {provider} model '{llm_model}'...", progress=1)
                    client = get_llm_client(provider)
                    client.ensure_model_available(
                        llm_model,
                        allow_download=allow_model_download,
                    )
                if collection is None:
                    collection = retrieval.get_collection()
                response_data = _generate_theme_payload(
                    client=client,
                    collection=collection,
                    theme_name=theme_name,
                    filters=filters,
                    provider=provider,
                    llm_model=llm_model,
                    llm_generation_settings=llm_generation_settings,
                    max_documents=max_documents,
                )
                cache[_cache_key(theme_name, filters)] = _stamped(response_data)
                generated += 1
            except Exception as exc:
                _reraise_fatal(exc)
                yield stream_event("progress", stage="process", message=f"Skipped {theme_name}: {str(exc)}", progress=_pct(i + 1), theme=theme_name)
                continue
            save_cache(cache)

        if precache_subthemes:
            subtheme_cache = load_subtheme_cache()
            for i, theme in enumerate(themes):
                theme_name = theme.get("name")
                response_data = cache.get(_cache_key(theme_name, filters))
                if not cache_has_full_dashboard_payload(response_data):
                    continue
                subthemes = [
                    subtheme
                    for subtheme in _subthemes_for_precompute(response_data)
                    if subtheme != theme_name
                ]
                for st_idx, subtheme in enumerate(subthemes):
                    sub_key = _cache_key(theme_name, filters, subtheme)
                    if sub_key in subtheme_cache and cache_has_full_subtheme_payload(
                        subtheme_cache[sub_key],
                        llm_provider=provider,
                        llm_model=llm_model,
                        llm_generation_settings=llm_generation_settings,
                        match_llm_identity=True,
                        cache_key=sub_key,
                    ):
                        continue
                    yield stream_event("progress", stage="process", message=f"Sub-theme {st_idx + 1}/{len(subthemes)}: "
                                f"{subtheme}", progress=_pct(i + 1), theme=theme_name)
                    attempted += 1
                    try:
                        if client is None:
                            yield stream_event("progress", stage="load", message=f"Checking {provider} model '{llm_model}'...", progress=1)
                            client = get_llm_client(provider)
                            client.ensure_model_available(
                                llm_model,
                                allow_download=allow_model_download,
                            )
                        if collection is None:
                            collection = retrieval.get_collection()
                        manifest = _manifest_for_subtheme(response_data, subtheme)
                        sub_data = _generate_theme_payload(
                            client=client,
                            collection=collection,
                            theme_name=theme_name,
                            filters=filters,
                            provider=provider,
                            llm_model=llm_model,
                            llm_generation_settings=llm_generation_settings,
                            max_documents=max_documents,
                            theme_query=subtheme,
                            evidence_ids=manifest.get("evidence_ids") or [],
                        )
                        subtheme_cache[sub_key] = _stamped(sub_data)
                        generated += 1
                        save_subtheme_cache(subtheme_cache)
                    except Exception as exc:
                        _reraise_fatal(exc)
                        yield stream_event("progress", stage="process", message=f"Sub-theme skipped {subtheme}: {str(exc)}", progress=_pct(i + 1), theme=theme_name)
                        continue

        # Optional pre-cache pass: cross-product of filter combinations.
        if valid_grid:
            skipped = len(normalized_grid) - len(valid_grid)
            if skipped:
                yield stream_event("progress", stage="process", message=f"Skipped {skipped} empty filter combinations (no matching documents)", progress=_pct(len(themes)))
            total_combos = len(valid_grid)
            for combo_idx, combo in enumerate(valid_grid):
                combo_label = ", ".join(f"{k}={v}" for k, v in combo.items()) or "baseline"
                for j, theme in enumerate(themes):
                    theme_name = theme.get("name")
                    # Step offset: baseline used steps 0..len(themes), grid continues from there.
                    overall_step = len(baseline_work) + combo_idx * len(themes) + j
                    base_progress = _pct(overall_step)

                    if (
                        _cached_dashboard_response(
                            cache,
                            theme_name,
                            filters=combo,
                            llm_provider=provider,
                            llm_model=llm_model,
                            llm_generation_settings=llm_generation_settings,
                            match_llm_identity=True,
                        )
                        is not None
                    ):
                        yield stream_event("progress", stage="process", message=f"[combo {combo_idx + 1}/{total_combos}: {combo_label}] "
                                    f"Cached: {theme_name}", progress=base_progress, theme=theme_name)
                        continue

                    yield stream_event("progress", stage="process", message=f"[combo {combo_idx + 1}/{total_combos}: {combo_label}] "
                                f"Generating {theme_name}...", progress=base_progress, theme=theme_name)

                    attempted += 1
                    try:
                        if client is None:
                            yield stream_event("progress", stage="load", message=f"Checking {provider} model '{llm_model}'...", progress=1)
                            client = get_llm_client(provider)
                            client.ensure_model_available(
                                llm_model,
                                allow_download=allow_model_download,
                            )
                        if collection is None:
                            collection = retrieval.get_collection()
                        response_data = _generate_theme_payload(
                            client=client,
                            collection=collection,
                            theme_name=theme_name,
                            filters=combo,
                            provider=provider,
                            llm_model=llm_model,
                            llm_generation_settings=llm_generation_settings,
                            max_documents=max_documents,
                        )
                        cache[_cache_key(theme_name, combo)] = _stamped(response_data)
                        generated += 1
                    except Exception as exc:
                        _reraise_fatal(exc)
                        yield stream_event("progress", stage="process", message=f"[combo {combo_idx + 1}/{total_combos}: {combo_label}] "
                                    f"Skipped {theme_name}: {str(exc)}", progress=base_progress, theme=theme_name)
                        continue
                    save_cache(cache)

                    if precache_subthemes:
                        subtheme_cache = load_subtheme_cache()
                        subthemes = [
                            subtheme
                            for subtheme in _subthemes_for_precompute(response_data)
                            if subtheme != theme_name
                        ]
                        for st_idx, subtheme in enumerate(subthemes):
                            sub_key = _cache_key(theme_name, combo, subtheme)
                            if sub_key in subtheme_cache and cache_has_full_subtheme_payload(
                                subtheme_cache[sub_key],
                                llm_provider=provider,
                                llm_model=llm_model,
                                llm_generation_settings=llm_generation_settings,
                                match_llm_identity=True,
                                cache_key=sub_key,
                            ):
                                continue
                            yield stream_event("progress", stage="process", message=f"[combo {combo_idx + 1}/{total_combos}: {combo_label}] "
                                        f"Sub-theme {st_idx + 1}/{len(subthemes)}: {subtheme}", progress=base_progress, theme=theme_name)
                            attempted += 1
                            try:
                                if client is None:
                                    yield stream_event("progress", stage="load", message=f"Checking {provider} model '{llm_model}'...", progress=1)
                                    client = get_llm_client(provider)
                                    client.ensure_model_available(
                                        llm_model,
                                        allow_download=allow_model_download,
                                    )
                                if collection is None:
                                    collection = retrieval.get_collection()
                                manifest = _manifest_for_subtheme(
                                    response_data, subtheme
                                )
                                sub_data = _generate_theme_payload(
                                    client=client,
                                    collection=collection,
                                    theme_name=theme_name,
                                    filters=combo,
                                    provider=provider,
                                    llm_model=llm_model,
                                    llm_generation_settings=llm_generation_settings,
                                    max_documents=max_documents,
                                    theme_query=subtheme,
                                    evidence_ids=manifest.get("evidence_ids") or [],
                                )
                                subtheme_cache[sub_key] = _stamped(sub_data)
                                generated += 1
                                save_subtheme_cache(subtheme_cache)
                            except Exception as exc:
                                _reraise_fatal(exc)
                                yield stream_event("progress", stage="process", message=f"[combo {combo_idx + 1}/{total_combos}: {combo_label}] "
                                            f"Sub-theme skipped {subtheme}: {str(exc)}", progress=base_progress, theme=theme_name)
                                continue

        if attempted and not generated:
            yield _nothing_generated_event(attempted)
            return
        yield stream_event("success", message="All insights generated!", progress=100)

    except model_downloads.ModelNotDownloadedError as exc:
        yield stream_event("error", code="error.model_missing", message=str(exc))
    except LocalModelConnectionError as exc:
        yield stream_event("error", code="error.llm_unavailable", message=str(exc))
    except Exception as exc:
        yield stream_event("error", code="error.backend", message=str(exc))
    finally:
        if client is not None:
            client.unload(llm_model)


def precompute_subthemes_stream(
    *,
    themes: list[dict],
    llm_model: str = DEFAULT_LLM_MODEL,
    allow_model_download: bool = False,
    provider: str = DEFAULT_LLM_PROVIDER,
    filters: dict | None = None,
    max_documents: int | None = None,
    filter_grid: list[dict] | None = None,
):
    themes = [t for t in themes if t.get("name") != LOW_INFORMATION_THEME]
    llm_model = str(llm_model or DEFAULT_LLM_MODEL).strip()
    provider = str(provider or DEFAULT_LLM_PROVIDER).strip()
    filters = _normalized_filters(filters)
    normalized_grid = [_normalized_filters(combo) for combo in (filter_grid or [])]
    baseline_key = json.dumps(filters, sort_keys=True)
    normalized_grid = [
        combo for combo in normalized_grid
        if json.dumps(combo, sort_keys=True) != baseline_key
    ]

    all_combos = [filters] + normalized_grid
    client = None
    attempted = generated = 0
    try:
        llm_generation_settings = _model_generation_settings(provider, llm_model)
        main_cache = load_cache()
        subtheme_cache = load_subtheme_cache()

        work_items = []
        for combo in all_combos:
            for theme in themes:
                theme_name = theme.get("name")
                main_key = _cache_key(theme_name, combo)
                main_entry = main_cache.get(main_key)
                # Subtheme generation only needs the parent cache as a source
                # manifest. Do not force users to regenerate expensive parent
                # theme insights just because they selected a different LLM for
                # the subtheme drilldowns.
                if not cache_has_full_dashboard_payload(main_entry):
                    continue
                subtheme_labels = [
                    subtheme
                    for subtheme in _subthemes_for_precompute(main_entry)
                    if subtheme != theme_name
                ]
                for subtheme in subtheme_labels:
                    sub_key = _cache_key(theme_name, combo, subtheme)
                    if sub_key in subtheme_cache and cache_has_full_subtheme_payload(
                        subtheme_cache[sub_key],
                        llm_provider=provider,
                        llm_model=llm_model,
                        llm_generation_settings=llm_generation_settings,
                        match_llm_identity=True,
                        cache_key=sub_key,
                    ):
                        continue
                    manifest = _manifest_for_subtheme(main_entry, subtheme)
                    work_items.append(
                        (
                            theme_name,
                            subtheme,
                            combo,
                            sub_key,
                            manifest.get("evidence_ids") or [],
                        )
                    )

        if not work_items:
            yield stream_event("success", message="All subtheme insights already cached!", progress=100)
            return

        yield stream_event("progress", stage="load", message=f"Checking {provider} model '{llm_model}'...", progress=1)

        collection = retrieval.get_collection()
        client = get_llm_client(provider)
        client.ensure_model_available(llm_model, allow_download=allow_model_download)

        total = len(work_items)
        for idx, (theme_name, subtheme, combo, sub_key, evidence_ids) in enumerate(work_items):
            progress = min(99, int((idx / total) * 100))
            combo_label = ", ".join(f"{k}={v}" for k, v in combo.items()) or "baseline"
            yield stream_event("progress", stage="process", message=f"[{combo_label}] Generating subtheme: {subtheme} ({idx + 1}/{total})", progress=progress, theme=theme_name)
            attempted += 1
            try:
                sub_data = _generate_theme_payload(
                    client=client,
                    collection=collection,
                    theme_name=theme_name,
                    filters=combo,
                    provider=provider,
                    llm_model=llm_model,
                    llm_generation_settings=llm_generation_settings,
                    theme_query=subtheme,
                    evidence_ids=evidence_ids,
                    max_documents=max_documents,
                )
                subtheme_cache[sub_key] = _stamped(sub_data)
                generated += 1
                save_subtheme_cache(subtheme_cache)
                quote_count = len(sub_data.get("quotes") or [])
                main_key = _cache_key(theme_name, combo)
                if main_key in main_cache:
                    for row in main_cache[main_key].get("subtheme_mentions") or []:
                        if row.get("subtheme") == subtheme:
                            row["quote_count"] = quote_count
                            break
                    save_cache(main_cache)
            except Exception as exc:
                _reraise_fatal(exc)
                yield stream_event("progress", stage="process", message=f"[{combo_label}] Skipped {subtheme}: {str(exc)}", progress=progress, theme=theme_name)
                continue

        if attempted and not generated:
            yield _nothing_generated_event(attempted)
            return
        yield stream_event("success", message="All subtheme insights generated!", progress=100)

    except model_downloads.ModelNotDownloadedError as exc:
        yield stream_event("error", code="error.model_missing", message=str(exc))
    except LocalModelConnectionError as exc:
        yield stream_event("error", code="error.llm_unavailable", message=str(exc))
    except Exception as exc:
        yield stream_event("error", code="error.backend", message=str(exc))
    finally:
        if client is not None:
            client.unload(llm_model)


def themes_overview_payload(filters: dict) -> dict:
    retrieval.get_collection()
    normalized_filters = _normalized_filters(filters)
    total_filtered_documents = retrieval.count_filtered_documents(normalized_filters)
    cached_values = [
        _sanitize_cached_subthemes(data)
        for data in load_cache().values()
        if cache_has_full_dashboard_payload(data)
    ]
    cache = {
        data.get("theme"): data
        for data in cached_values
        if _cache_filters_match(data, {})
    }
    themes = cache
    if not cached_values:
        return {
            "status": "not_ready",
            "reason": "no_summaries",
            "themes": {},
            "themes_expected": 7,
        }
    if not normalized_filters:
        return {
            "status": "success",
            "filters_applied": normalized_filters,
            "total_filtered_documents": total_filtered_documents,
            "themes": themes,
        }

    exact_filter_cache = {
        data.get("theme"): data
        for data in cached_values
        if _cache_filters_match(data, normalized_filters)
    }
    try:
        filtered_cache = retrieval.filtered_themes_overview(cache, normalized_filters)
        themes = {**filtered_cache, **exact_filter_cache}
    except Exception as exc:
        print(f"[DYNAMIC FILTER ERROR] {str(exc)}")
        themes = {**cache, **exact_filter_cache}

    return {
        "status": "success",
        "filters_applied": normalized_filters,
        "total_filtered_documents": total_filtered_documents,
        "themes": themes,
    }


def start_llm_stream(model_name: str, provider: str = DEFAULT_LLM_PROVIDER):
    """NDJSON for starting the local LLM: download events, then `load`, then success.

    One attempt, no retries. If the server can't start within
    LLAMA_CPP_STARTUP_TIMEOUT (counted only once the files are local), or is
    missing or exits early, the stream ends with `error.llm_unavailable`.
    """
    model = llama_cpp_models.resolve_llama_cpp_model(model_name)
    tier = tier_for_model("insights", model.id)
    downloaded = yield from model_downloads.download_events(
        model.repo_id, tier, allow_patterns=model.download_patterns
    )
    if not downloaded:
        return
    yield stream_event("progress", stage="load", params={"tier": tier, "model": model.id},
                       message=f"Starting {provider} with '{model.id}'...")
    try:
        get_llm_client(provider).ensure_model_available(model.id, allow_download=True)
    except model_downloads.ModelNotDownloadedError as exc:
        yield stream_event("error", code="error.model_missing", params={"tier": tier, "model": model.id}, error=str(exc))
        return
    except Exception as exc:
        print(f"[LLAMA_CPP START ERROR] {exc}")
        yield stream_event("error", code="error.llm_unavailable", params={"tier": tier, "model": model.id}, error=str(exc))
        return
    yield stream_event("success", params={"tier": tier, "model": model.id}, message=f"{model.id} is ready")
