from .anonymize_routes import anonymize_bp
from .insight_routes import insight_bp
from .pipeline_routes import pipeline_bp
from .vector_routes import vector_bp


def register_blueprints(app):
    app.register_blueprint(anonymize_bp)
    app.register_blueprint(vector_bp)
    app.register_blueprint(insight_bp)
    app.register_blueprint(pipeline_bp)
