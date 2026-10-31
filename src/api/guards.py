"""Server-side refusals shared by the pipeline routes (409 before any streaming)."""
from flask import jsonify

from src.pipeline import jobs
from src.pipeline import status as pipeline_status


def anonymize_gate(route: str):
    """409 `error.blocked` unless step 1 is `done` (D7); None when allowed.

    Steps 2 to 5 never read answers whose anonymisation is unverified, still
    needs review, is running, or does not exist. Fails closed when the status
    can't be built.
    """
    try:
        anonymize_state = pipeline_status.build_pipeline_status()["steps"]["anonymize"]["state"]
    except Exception as exc:
        print(f"[{route} GATE ERROR] {exc}")
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


def busy_response(exc: jobs.JobBusy):
    """409 `error.busy`: another pipeline job already runs (`params.step`)."""
    return (
        jsonify(
            {
                "status": "error",
                "code": "error.busy",
                "params": {"step": exc.step},
                "error": f"Step {exc.step} is still running",
            }
        ),
        409,
    )
