from django.apps import AppConfig


class FeatureFlagsConfig(AppConfig):
    # BigAutoField is Django's default for a new project. PostHog's flags app
    # uses AutoField (32-bit) because existing rows and the Rust flags service
    # already decode ``id`` as i32. Ensaio has neither, so the wider key is the
    # simpler choice. See products/feature_flags/backend/apps.py in the PostHog
    # checkout for the constraint we do not have.
    default_auto_field = "django.db.models.BigAutoField"
    name = "products.feature_flags.backend"
    # The last path segment would otherwise be the label: ``backend``. Every
    # product app would then collide on that one label. PostHog sets this
    # explicitly for the same reason.
    label = "feature_flags"
