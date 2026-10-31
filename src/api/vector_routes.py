from importlib import import_module

from flask import Blueprint, Response, jsonify, request

from src.pipeline import status as pipeline_status

vector_bp = Blueprint("vector", __name__)
embedding = import_module("src.pipeline.02_embedding.service")
retrieval = import_module("src.pipeline.03_retrieval.service")


def _anonymize_gate():
    """409 unless step 1 is `done` (D7).

    Never embed answers whose anonymisation is unverified, still needs review,
    is running, or does not exist. Fails closed when the status can't be built.
    """
    try:
        anonymize_state = pipeline_status.build_pipeline_status()["steps"]["anonymize"]["state"]
    except Exception as exc:
        print(f"[BUILD-VECTORS GATE ERROR] {exc}")
        anonymize_state = None
    if anonymize_state == "done":
        return None
    return (
        jsonify(
            {
                "status": "error",
                "code": "error.blocked",
                "params": {"step": "anonymize"},
                "error": f"Step 1 (anonymize) is not done (state: {anonymize_state})",
            }
        ),
        409,
    )


@vector_bp.route("/api/status", methods=["GET"])
def status():
    return jsonify(embedding.pipeline_status_payload())


@vector_bp.route("/api/build-vectors", methods=["POST"])
def build_vectors():
    blocked = _anonymize_gate()
    if blocked is not None:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        stream = embedding.build_vectors_stream(
            embedding_model=data.get("embedding_model"),
            selected_columns=data.get("selected_columns"),
            allow_model_download=bool(data.get("allow_model_download", True)),
        )
        return Response(stream, mimetype="application/x-ndjson")
    except FileNotFoundError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        print(f"[BUILD-VECTORS ERROR] {str(exc)}")
        return jsonify({"status": "error", "error": str(exc)}), 500


@vector_bp.route("/api/rerank-theme-assignments", methods=["POST"])
def rerank_theme_assignments():
    try:
        data = request.get_json(silent=True) or {}
        max_documents = data.get("max_documents")
        stream = embedding.rerank_theme_assignments_stream(
            reranker_model=data.get("reranker_model"),
            allow_model_download=bool(data.get("allow_model_download", True)),
            max_documents=(
                int(max_documents)
                if max_documents is not None and str(max_documents).strip()
                else None
            ),
        )
        return Response(stream, mimetype="application/x-ndjson")
    except Exception as exc:
        print(f"[RERANK-THEMES ERROR] {str(exc)}")
        return jsonify({"status": "error", "error": str(exc)}), 500


@vector_bp.route("/api/vector-checkpoint-status", methods=["GET"])
def vector_checkpoint_status():
    return jsonify(embedding.vector_checkpoint_status_payload())


@vector_bp.route("/api/filter-options", methods=["GET"])
def get_filter_options():
    try:
        filters = _filters_from_args(all_value="all")
        if filters:
            return jsonify(retrieval.filter_options_for_selection(filters)), 200
        return jsonify(retrieval.filter_options_payload()), 200
    except Exception as exc:
        print(f"[FILTER OPTIONS ERROR] {str(exc)}")
        return jsonify({"status": "error", "error": str(exc)}), 500


@vector_bp.route("/api/query-vectors", methods=["GET"])
def query_vectors():
    try:
        query_text = request.args.get("query", "").strip()
        top_k = min(int(request.args.get("n", 10)), 50)
        filters = _filters_from_args(all_value="all")
        return jsonify(retrieval.query_vectors_payload(query_text, top_k, filters))
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        message = str(exc)
        if "not found" in message.lower() or "does not exist" in message.lower():
            return jsonify(
                {
                    "status": "error",
                    "error": "Vector database not found. Build vectors first.",
                }
            ), 400
        print(f"[QUERY ERROR] {message}")
        return jsonify({"status": "error", "error": message}), 500


@vector_bp.route("/api/vector-stats", methods=["GET"])
def vector_stats():
    try:
        return jsonify(retrieval.vector_stats_payload()), 200
    except Exception as exc:
        print(f"[VECTOR STATS ERROR] {str(exc)}")
        return jsonify({"status": "error", "error": str(exc)}), 500


def _filters_from_args(all_value: str) -> dict:
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
        if value and value != all_value:
            filters[key] = value
    return filters
