from typing import Any, cast

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from products.feature_flags.backend.models import FeatureFlag, Team

pytestmark = pytest.mark.django_db


def _authenticated_client() -> tuple[APIClient, User]:
    user = User.objects.create_user(username="andre", password="test-password")
    client = APIClient()
    client.force_login(user)
    return client, user


def _filters() -> dict[str, object]:
    return {
        "groups": [
            {
                "properties": [],
                "rollout_percentage": 100,
                "variant": None,
            }
        ]
    }


def _list_url(team: Team) -> str:
    return f"/api/projects/{team.pk}/feature_flags/"


def _detail_url(team: Team, flag: FeatureFlag) -> str:
    return f"{_list_url(team)}{flag.pk}/"


def test_management_api_requires_session_authentication() -> None:
    team = Team.objects.create(name="Growth")

    response = APIClient().get(_list_url(team))

    assert response.status_code == 403


def test_create_injects_team_and_creator_instead_of_trusting_the_body() -> None:
    client, user = _authenticated_client()
    team = Team.objects.create(name="Growth")
    other_team = Team.objects.create(name="Other")

    response = client.post(
        _list_url(team),
        {
            "team_id": other_team.pk,
            "created_by_id": None,
            "key": "new-checkout",
            "name": "New checkout",
            "active": True,
            "filters": _filters(),
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    flag = FeatureFlag.objects.get()
    assert flag.team == team
    assert flag.created_by == user
    assert flag.version == 1
    assert response.data["team_id"] == team.pk
    assert response.data["created_by_id"] == user.pk


def test_list_only_returns_live_flags_from_url_team() -> None:
    client, user = _authenticated_client()
    team = Team.objects.create(name="Growth")
    other_team = Team.objects.create(name="Other")
    visible = FeatureFlag.objects.create(team=team, key="visible", created_by=user)
    FeatureFlag.objects.create(team=other_team, key="other", created_by=user)
    FeatureFlag.objects.create(team=team, key="deleted", deleted=True, created_by=user)

    response = client.get(_list_url(team))

    assert response.status_code == 200
    ids = [item["id"] for item in cast(list[dict[str, Any]], response.data)]
    assert ids == [visible.pk]


def test_cannot_read_other_teams_flag() -> None:
    client, user = _authenticated_client()
    team = Team.objects.create(name="Growth")
    other_team = Team.objects.create(name="Other")
    other_flag = FeatureFlag.objects.create(team=other_team, key="private", created_by=user)

    response = client.get(_detail_url(team, other_flag))

    assert response.status_code == 404


def test_patch_updates_fields_and_advances_version() -> None:
    client, user = _authenticated_client()
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(team=team, key="checkout", created_by=user)

    response = client.patch(_detail_url(team, flag), {"name": "Checkout v2"}, format="json")

    assert response.status_code == 200, response.data
    flag.refresh_from_db()
    assert flag.name == "Checkout v2"
    assert flag.version == 2
    assert response.data["version"] == 2


def test_delete_soft_deletes_and_frees_key_for_reuse() -> None:
    client, user = _authenticated_client()
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(team=team, key="checkout", created_by=user)

    delete_response = client.delete(_detail_url(team, flag))
    create_response = client.post(_list_url(team), {"key": "checkout", "filters": _filters()}, format="json")

    assert delete_response.status_code == 204
    flag.refresh_from_db()
    assert flag.deleted
    assert flag.version == 2
    assert create_response.status_code == 201, create_response.data


def test_duplicate_live_key_returns_validation_error() -> None:
    client, user = _authenticated_client()
    team = Team.objects.create(name="Growth")
    FeatureFlag.objects.create(team=team, key="checkout", created_by=user)

    response = client.post(_list_url(team), {"key": "checkout", "filters": _filters()}, format="json")

    assert response.status_code == 400
    assert "key" in response.data


def test_invalid_slug_and_filters_return_field_errors() -> None:
    client, _user = _authenticated_client()
    team = Team.objects.create(name="Growth")

    response = client.post(
        _list_url(team),
        {
            "key": "not a slug",
            "filters": {"groups": [{"properties": [], "rollout_percentage": 101}]},
        },
        format="json",
    )

    assert response.status_code == 400
    assert "key" in response.data
    assert "filters" in response.data
