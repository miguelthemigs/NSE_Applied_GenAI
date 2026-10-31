from flask import Blueprint, jsonify, request

from src.pipeline import state, status

pipeline_bp = Blueprint("pipeline", __name__)


def _status_response():
    try:
        return jsonify(status.build_pipeline_status())
    except Exception as exc:
        print(f"[PIPELINE STATUS ERROR] {exc}")
        return jsonify({"status": "error", "error": str(exc)}), 500


@pipeline_bp.route("/api/pipeline/status", methods=["GET"])
def pipeline_status():
    return _status_response()


@pipeline_bp.route("/api/pipeline/acknowledge-review", methods=["POST"])
def acknowledge_review():
    state.set_flag("anonymize", "acknowledged", True)
    return _status_response()


@pipeline_bp.route("/api/pipeline/skip-rerank", methods=["POST"])
def skip_rerank():
    data = request.get_json(silent=True) or {}
    skipped = data.get("skipped")
    if not isinstance(skipped, bool):
        return jsonify({"status": "error", "error": "skipped must be a boolean"}), 400
    state.set_flag("rerank", "skipped", skipped)
    return _status_response()
