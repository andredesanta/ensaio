from django.apps import apps
from django.test import Client


def test_feature_flags_app_label_is_not_backend() -> None:
    """Two products that both end in ``backend`` cannot share Django's app registry.

    Django's default label is the last dotted segment of the app name. Leaving
    it as ``backend`` means the next product app fails to boot with a duplicate
    label. The label is what migrations and ``apps.get_model`` key on.
    """
    config = apps.get_app_config("feature_flags")
    assert config.name == "products.feature_flags.backend"


def test_healthz_does_not_touch_the_database(client: Client) -> None:
    """``/healthz`` is liveness, not readiness.

    pytest-django raises if a test without the ``db`` fixture hits the database.
    A future change that queries Postgres from this view fails here, including
    in CI, where Postgres is not running.
    """
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.content == b"ok"
