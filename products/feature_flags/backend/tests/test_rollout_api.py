from typing import Any

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from products.feature_flags.backend.models import FeatureFlag, GuardrailSample, RolloutPlan, Team

pytestmark = pytest.mark.django_db


def _authenticated_client() -> APIClient:
    user = User.objects.create_user(username="andre", password="test-password")
    client = APIClient()
    client.force_login(user)
    return client


def _flag(team: Team) -> FeatureFlag:
    return FeatureFlag.objects.create(
        team=team,
        key="checkout",
        filters={
            "groups": [
                {"properties": [], "rollout_percentage": 100, "variant": None},
                {"properties": [], "rollout_percentage": 80, "variant": None},
            ]
        },
    )


def _plan_payload(
    *,
    status: str = "DRAFT",
    managed_group_index: int = 0,
    expected_plan_id: int | None = None,
    expected_version: int | None = None,
) -> dict[str, Any]:
    return {
        "expected_plan_id": expected_plan_id,
        "expected_version": expected_version,
        "status": status,
        "managed_group_index": managed_group_index,
        "phases": [
            {"percentage": 10, "min_duration_minutes": 5},
            {"percentage": 50, "min_duration_minutes": 10},
            {"percentage": 100, "min_duration_minutes": 15},
        ],
        "guardrail": {
            "name": "error_rate",
            "comparison": "lt",
            "threshold": 0.02,
            "window_minutes": 15,
            "min_samples": 100,
            "max_hold_minutes": 30,
        },
    }


def _plan_url(team: Team, flag: FeatureFlag) -> str:
    return f"/api/projects/{team.pk}/feature_flags/{flag.pk}/rollout_plan/"


def _samples_url(team: Team, flag: FeatureFlag) -> str:
    return f"/api/projects/{team.pk}/feature_flags/{flag.pk}/guardrail_samples/"


def test_rollout_plan_is_project_scoped_and_requires_session_authentication() -> None:
    team = Team.objects.create(name="Growth")
    other_team = Team.objects.create(name="Other")
    flag = _flag(team)

    assert APIClient().get(_plan_url(team, flag)).status_code == 403
    assert _authenticated_client().get(_plan_url(other_team, flag)).status_code == 404


def test_put_creates_and_updates_a_plan_and_get_returns_recent_samples() -> None:
    client = _authenticated_client()
    team = Team.objects.create(name="Growth")
    flag = _flag(team)

    created = client.put(_plan_url(team, flag), _plan_payload(), format="json")
    samples = [
        client.post(
            _samples_url(team, flag),
            {"value": 0.01 + index / 1000, "sample_count": 120 + index},
            format="json",
        )
        for index in range(6)
    ]
    retrieved = client.get(_plan_url(team, flag))
    flag_response = client.get(f"/api/projects/{team.pk}/feature_flags/{flag.pk}/")

    assert created.status_code == 201, created.data
    assert all(sample.status_code == 201 for sample in samples)
    assert retrieved.status_code == 200
    assert retrieved.data["flag_id"] == flag.pk
    assert retrieved.data["status"] == RolloutPlan.Status.DRAFT
    assert [sample["id"] for sample in retrieved.data["recent_samples"]] == [
        sample.data["id"] for sample in reversed(samples[1:])
    ]
    assert flag_response.data["rollout_plan_status"] == RolloutPlan.Status.DRAFT
    assert GuardrailSample.objects.filter(plan__flag=flag).count() == 6


def test_plan_validation_rejects_missing_groups_non_monotone_phases_and_internal_statuses() -> None:
    client = _authenticated_client()
    team = Team.objects.create(name="Growth")
    flag = _flag(team)
    bad_group = client.put(_plan_url(team, flag), _plan_payload(managed_group_index=2), format="json")

    non_monotone = _plan_payload()
    non_monotone["phases"][1]["percentage"] = 5
    bad_phases = client.put(_plan_url(team, flag), non_monotone, format="json")
    internal_status = client.put(
        _plan_url(team, flag),
        _plan_payload(status=RolloutPlan.Status.COMPLETED),
        format="json",
    )

    assert bad_group.status_code == 400
    assert "managed_group_index" in bad_group.data
    assert bad_phases.status_code == 400
    assert "phases" in bad_phases.data
    assert internal_status.status_code == 400
    assert "status" in internal_status.data


def test_activating_and_manually_reverting_a_plan_only_change_the_managed_group() -> None:
    client = _authenticated_client()
    team = Team.objects.create(name="Growth")
    flag = _flag(team)

    activated = client.put(_plan_url(team, flag), _plan_payload(status="ACTIVE"), format="json")
    flag.refresh_from_db()
    activated_version = flag.version

    reverted = client.put(
        _plan_url(team, flag),
        _plan_payload(
            status="REVERTED",
            expected_plan_id=activated.data["id"],
            expected_version=activated.data["version"],
        ),
        format="json",
    )
    flag.refresh_from_db()

    assert activated.status_code == 201, activated.data
    assert flag.filters["groups"][0]["rollout_percentage"] == 0
    assert flag.filters["groups"][1]["rollout_percentage"] == 80
    assert flag.version == activated_version + 1
    assert reverted.data["status"] == RolloutPlan.Status.REVERTED
    assert reverted.data["hold_reason"] == "manual_revert"


def test_direct_edit_of_the_managed_percentage_returns_conflict_but_other_edits_remain_allowed() -> None:
    client = _authenticated_client()
    team = Team.objects.create(name="Growth")
    flag = _flag(team)
    client.put(_plan_url(team, flag), _plan_payload(), format="json")

    changed_filters = {
        "groups": [
            {"properties": [], "rollout_percentage": 20, "variant": None},
            {"properties": [], "rollout_percentage": 80, "variant": None},
        ]
    }
    conflict = client.patch(
        f"/api/projects/{team.pk}/feature_flags/{flag.pk}/",
        {"filters": changed_filters, "expected_version": flag.version},
        format="json",
    )
    renamed = client.patch(
        f"/api/projects/{team.pk}/feature_flags/{flag.pk}/",
        {"name": "Checkout v2", "expected_version": flag.version},
        format="json",
    )

    assert conflict.status_code == 409
    assert conflict.data == {
        "detail": "This rollout percentage is managed by the rollout plan. Update the plan instead.",
        "code": "managed_by_rollout_plan",
    }
    assert renamed.status_code == 200


def test_delete_removes_the_plan_without_changing_the_flag() -> None:
    client = _authenticated_client()
    team = Team.objects.create(name="Growth")
    flag = _flag(team)
    created = client.put(_plan_url(team, flag), _plan_payload(), format="json")

    response = client.delete(
        f"{_plan_url(team, flag)}?expected_plan_id={created.data['id']}&expected_version={created.data['version']}"
    )

    assert response.status_code == 204
    assert not RolloutPlan.objects.filter(flag=flag).exists()
    assert FeatureFlag.objects.filter(pk=flag.pk).exists()
