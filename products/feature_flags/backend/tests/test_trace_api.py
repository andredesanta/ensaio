import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from products.feature_flags.backend.models import FeatureFlag, Team

pytestmark = pytest.mark.django_db


def _client_and_user() -> tuple[APIClient, User]:
    user = User.objects.create_user(username="andre")
    client = APIClient()
    client.force_login(user)
    return client, user


def test_trace_runs_persisted_definition_through_pure_kernel() -> None:
    client, user = _client_and_user()
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(
        team=team,
        key="new-checkout",
        version=3,
        created_by=user,
        filters={
            "groups": [
                {
                    "properties": [
                        {
                            "key": "country",
                            "type": "person",
                            "operator": "exact",
                            "value": ["BR"],
                        }
                    ],
                    "rollout_percentage": 75,
                    "variant": None,
                }
            ],
            "multivariate": {
                "variants": [
                    {"key": "control", "rollout_percentage": 50},
                    {"key": "test", "rollout_percentage": 50},
                ]
            },
        },
    )

    response = client.post(
        f"/api/projects/{team.pk}/feature_flags/{flag.pk}/trace/",
        {"distinct_id": "u_7", "properties": {"country": "BR"}},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert response.data["enabled"] is True
    assert response.data["variant"] == "test"
    assert response.data["reason"] == "condition_match"
    assert response.data["condition_index"] == 0
    assert [step["step"] for step in response.data["trace"]] == [
        "flag_active",
        "property",
        "condition",
        "rollout_hash",
        "variant_hash",
    ]


def test_trace_is_scoped_by_team() -> None:
    client, user = _client_and_user()
    team = Team.objects.create(name="Growth")
    other_team = Team.objects.create(name="Other")
    flag = FeatureFlag.objects.create(team=other_team, key="private", created_by=user)

    response = client.post(
        f"/api/projects/{team.pk}/feature_flags/{flag.pk}/trace/",
        {"distinct_id": "u_7", "properties": {}},
        format="json",
    )

    assert response.status_code == 404


def test_trace_rejects_non_object_properties() -> None:
    client, user = _client_and_user()
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(team=team, key="checkout", created_by=user)

    response = client.post(
        f"/api/projects/{team.pk}/feature_flags/{flag.pk}/trace/",
        {"distinct_id": "u_7", "properties": ["not", "an", "object"]},
        format="json",
    )

    assert response.status_code == 400
    assert "properties" in response.data


def test_trace_preserves_null_as_a_present_property_value() -> None:
    client, user = _client_and_user()
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(
        team=team,
        key="nullable-property",
        created_by=user,
        filters={
            "groups": [
                {
                    "properties": [
                        {
                            "key": "company_id",
                            "type": "person",
                            "operator": "is_set",
                        }
                    ],
                    "rollout_percentage": 100,
                    "variant": None,
                }
            ]
        },
    )

    response = client.post(
        f"/api/projects/{team.pk}/feature_flags/{flag.pk}/trace/",
        {"distinct_id": "u_7", "properties": {"company_id": None}},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert response.data["enabled"] is True
