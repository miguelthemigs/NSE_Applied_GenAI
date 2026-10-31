from flask import Blueprint, jsonify, request

from src.config.model_tiers import model_tiers_payload
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
    """Tick "I have reviewed the possible misses" for one specific report.

    The client sends the `report_id` it showed the user
    (`steps.anonymize.summary.report_id`). A missing or outdated id means the
    user reviewed a different miss list, so nothing is saved: 409 with
    `code: "error.stale_review"` plus the current status, so the UI can
    re-render the new list.
    """
    data = request.get_json(silent=True) or {}
    report_id = data.get("report_id")
    current = status.current_report_id()
    if current is None or not isinstance(report_id, str) or report_id != current:
        try:
            payload = status.build_pipeline_status()
        except Exception as exc:
            print(f"[PIPELINE STATUS ERROR] {exc}")
            payload = {}
        return jsonify({**payload, "status": "error", "code": "error.stale_review"}), 409
    state.acknowledge_review(report_id)
    return _status_response()


@pipeline_bp.route("/api/pipeline/skip-rerank", methods=["POST"])
def skip_rerank():
    data = request.get_json(silent=True) or {}
    skipped = data.get("skipped")
    if not isinstance(skipped, bool):
        return jsonify({"status": "error", "error": "skipped must be a boolean"}), 400
    state.set_flag("rerank", "skipped", skipped)
    return _status_response()


@pipeline_bp.route("/api/model-tiers", methods=["GET"])
def model_tiers():
    """The three tiers per step plus the technical ids for Advanced.

    Size and cache lookups are best-effort: they never fail or block the route.
    """
    return jsonify(model_tiers_payload())
