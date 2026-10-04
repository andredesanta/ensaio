import json
import re
from io import StringIO
from typing import Any

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from rest_framework.test import APIClient
from structlog.testing import capture_logs

from products.feature_flags.backend.models import AutomationToken, FeatureFlag, Team

pytestmark = pytest.mark.django_db


def _issue(
    team: Team,
    user: User,
    *,
    scopes: list[str] | None = None,
) -> tuple[AutomationToken, str]:
    return AutomationToken.issue(
        team=team,
        user=user,
        name="pytest-agent",
        scopes=scopes or ["feature_flag:read"],
    )


def _client(raw_token: str) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw_token}")
    return client


def _flag(team: Team, *, key: str = "checkout", active: bool = True) -> FeatureFlag:
    return FeatureFlag.objects.create(
        team=team,
        key=key,
        active=active,
        filters={"groups": [{"properties": [], "rollout_percentage": 10, "variant": None}]},
    )


def test_token_issue_returns_exact_shape_once_and_persists_only_a_hash() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="agent-owner")

    token, raw = _issue(team, user)
    prefix, selector, secret = re.split(r"([A-Za-z0-9_-]{22})\.", raw, maxsplit=1)

    assert prefix == "ens_pat_"
    assert selector == token.selector
    assert len(secret) == 43
    assert secret not in token.secret_hash
    assert raw not in token.secret_hash
    assert token.check_secret(secret)


def test_issue_and_revoke_commands_validate_operators_and_are_idempotent() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="operator")
    output = StringIO()
    errors = StringIO()

    call_command(
        "issue_agent_token",
        "--team-id",
        str(team.pk),
        "--user-id",
        str(user.pk),
        "--name",
        "local-cursor",
        "--scope",
        "feature_flag:read",
        "--scope",
        "feature_flag:write",
        stdout=output,
        stderr=errors,
    )
    raw = output.getvalue().strip()
    token = AutomationToken.objects.get()
    first_revoke = StringIO()
    second_revoke = StringIO()
    call_command("revoke_agent_token", selector=token.selector, stdout=first_revoke)
    call_command("revoke_agent_token", selector=token.selector, stdout=second_revoke)

    token.refresh_from_db()
    assert raw.startswith(f"ens_pat_{token.selector}.")
    assert raw not in token.secret_hash
    assert "cannot be recovered" in errors.getvalue()
    assert token.revoked_at is not None
    assert "revoked" in first_revoke.getvalue()
    assert "already revoked" in second_revoke.getvalue()

    with pytest.raises(CommandError, match="Duplicate"):
        call_command(
            "issue_agent_token",
            "--team-id",
            str(team.pk),
            "--user-id",
            str(user.pk),
            "--name",
            "duplicate",
            "--scope",
            "feature_flag:read",
            "--scope",
            "feature_flag:read",
        )
    with pytest.raises(CommandError, match="Unknown"):
        call_command(
            "issue_agent_token",
            "--team-id",
            str(team.pk),
            "--user-id",
            str(user.pk),
            "--name",
            "unknown",
            "--scope",
            "admin",
        )
    user.is_active = False
    user.save(update_fields={"is_active"})
    with pytest.raises(CommandError, match="inactive"):
        call_command(
            "issue_agent_token",
            "--team-id",
            str(team.pk),
            "--user-id",
            str(user.pk),
            "--name",
            "inactive-owner",
            "--scope",
            "feature_flag:read",
        )


def test_response_matrix_preserves_bearer_session_and_csrf_semantics() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="andre", password="test-password")
    _token, read_token = _issue(team, user)
    url = f"/api/projects/{team.pk}/feature_flags/"

    anonymous = APIClient().get(url)
    invalid = _client("ens_pat_AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB").get(url)
    read_success = _client(read_token).get(url)
    read_write_denied = _client(read_token).post(url, {"key": "new"}, format="json")

    session = APIClient()
    session.force_login(user)
    session_success = session.get(url)
    csrf_session = APIClient(enforce_csrf_checks=True)
    csrf_session.force_login(user)
    csrf_denied = csrf_session.post(url, {"key": "new"}, format="json")

    assert anonymous.status_code == 403
    assert "WWW-Authenticate" not in anonymous
    assert invalid.status_code == 401
    assert invalid["WWW-Authenticate"] == "Bearer"
    assert read_success.status_code == 200
    assert read_success.wsgi_request.user == user
    assert read_write_denied.status_code == 403
    assert session_success.status_code == 200
    assert csrf_denied.status_code == 403


def test_raw_automation_token_never_appears_in_structured_logs() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="agent-owner")
    _token, raw = _issue(team, user)

    with capture_logs() as logs:
        response = _client(raw).get(f"/api/projects/{team.pk}/feature_flags/")

    assert response.status_code == 200
    assert raw not in json.dumps(logs)


def test_write_scope_implies_read_and_read_scope_can_trace_post() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="agent-owner")
    flag = _flag(team)
    _write, write_token = _issue(team, user, scopes=["feature_flag:write"])
    _read, read_token = _issue(team, user)

    listed = _client(write_token).get(f"/api/projects/{team.pk}/feature_flags/")
    traced = _client(read_token).post(
        f"/api/projects/{team.pk}/feature_flags/{flag.pk}/trace/",
        {"distinct_id": "synthetic-user", "properties": {}},
        format="json",
    )

    assert listed.status_code == 200
    assert traced.status_code == 200


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/feature_flags/"),
        ("post", "/feature_flags/"),
        ("get", "/feature_flags/by_key/?key=private"),
        ("get", "/feature_flags/{flag_id}/"),
        ("patch", "/feature_flags/{flag_id}/"),
        ("delete", "/feature_flags/{flag_id}/"),
        ("post", "/feature_flags/{flag_id}/trace/"),
        ("post", "/feature_flags/{flag_id}/enable/"),
        ("post", "/feature_flags/{flag_id}/disable/"),
        ("post", "/feature_flags/{flag_id}/set_rollout_percentage/"),
        ("get", "/feature_flags/{flag_id}/rollout_plan/"),
        ("put", "/feature_flags/{flag_id}/rollout_plan/"),
        ("delete", "/feature_flags/{flag_id}/rollout_plan/"),
        ("post", "/feature_flags/{flag_id}/guardrail_samples/"),
    ],
)
def test_foreign_project_is_rejected_before_every_query_or_action(method: str, path: str) -> None:
    token_team = Team.objects.create(name="Token team")
    foreign_team = Team.objects.create(name="Foreign team")
    user = User.objects.create_user(username=f"owner-{method}-{path}")
    foreign_flag = _flag(foreign_team, key="private")
    _token, raw = _issue(token_team, user, scopes=["feature_flag:read", "feature_flag:write"])
    url = f"/api/projects/{foreign_team.pk}{path.format(flag_id=foreign_flag.pk)}"

    response = getattr(_client(raw), method)(url, {}, format="json")

    assert response.status_code == 404
    assert response.data["code"] == "project_not_found"


@pytest.mark.parametrize(
    "authorization",
    [
        "Basic abc",
        "bearer ens_pat_AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        "Bearer",
        "Bearer too.many.parts",
        "Bearer ens_pat_short.short",
        "Bearer ens_pub_not-management",
    ],
)
def test_malformed_automation_headers_are_unauthorized(authorization: str) -> None:
    team = Team.objects.create(name=f"Malformed {authorization}")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=authorization)

    response = client.get(f"/api/projects/{team.pk}/feature_flags/")

    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"


def test_oversized_token_is_rejected_before_a_database_lookup(django_assert_num_queries: Any) -> None:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer ens_pat_{'A' * 500}")

    with django_assert_num_queries(0):
        response = client.get("/api/projects/1/feature_flags/")

    assert response.status_code == 401


def test_revoked_token_and_inactive_owner_are_rejected() -> None:
    team = Team.objects.create(name="Growth")
    revoked_user = User.objects.create_user(username="revoked-owner")
    inactive_user = User.objects.create_user(username="inactive-owner", is_active=False)
    revoked, revoked_raw = _issue(team, revoked_user)
    _inactive, inactive_raw = _issue(team, inactive_user)
    revoked.revoked_at = timezone.now()
    revoked.save(update_fields={"revoked_at"})
    url = f"/api/projects/{team.pk}/feature_flags/"

    assert _client(revoked_raw).get(url).status_code == 401
    assert _client(inactive_raw).get(url).status_code == 401


def test_exact_key_and_controlled_absence_do_not_expose_deleted_or_foreign_flags() -> None:
    team = Team.objects.create(name="Growth")
    other = Team.objects.create(name="Other")
    user = User.objects.create_user(username="agent-owner")
    visible = _flag(team, key="exact-key")
    _flag(other, key="foreign")
    deleted = _flag(team, key="deleted")
    deleted.deleted = True
    deleted.save(update_fields={"deleted"})
    _token, raw = _issue(team, user)
    client = _client(raw)
    base = f"/api/projects/{team.pk}/feature_flags/by_key/"

    found = client.get(base, {"key": "exact-key"})
    missing = client.get(base, {"key": "missing"})
    deleted_response = client.get(base, {"key": "deleted"})
    foreign = client.get(base, {"key": "foreign"})

    assert found.status_code == 200
    assert found.data["id"] == visible.pk
    for response in (missing, deleted_response, foreign):
        assert response.status_code == 404
        assert response.data["code"] == "flag_not_found"


def test_enable_disable_are_idempotent_and_version_only_real_changes() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="agent-owner")
    flag = _flag(team, active=False)
    _token, raw = _issue(team, user, scopes=["feature_flag:write"])
    client = _client(raw)
    base = f"/api/projects/{team.pk}/feature_flags/{flag.pk}"

    enabled = client.post(f"{base}/enable/", {}, format="json")
    repeated = client.post(f"{base}/enable/", {}, format="json")
    disabled = client.post(f"{base}/disable/", {}, format="json")

    assert enabled.data["version"] == 2
    assert repeated.data["version"] == 2
    assert disabled.data["version"] == 3


def test_stale_patch_and_rollout_change_conflict_without_losing_unrelated_filters() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="agent-owner")
    flag = FeatureFlag.objects.create(
        team=team,
        key="checkout",
        filters={
            "groups": [
                {"properties": [{"key": "plan", "operator": "exact", "value": "pro"}], "rollout_percentage": 10},
                {"properties": [], "rollout_percentage": 80},
            ],
            "multivariate": {
                "variants": [
                    {"key": "control", "rollout_percentage": 50},
                    {"key": "test", "rollout_percentage": 50},
                ]
            },
            "payloads": {"test": {"color": "blue"}},
        },
    )
    _token, raw = _issue(team, user, scopes=["feature_flag:write"])
    client = _client(raw)
    detail = f"/api/projects/{team.pk}/feature_flags/{flag.pk}/"
    missing_version = client.patch(detail, {"name": "Unsafe"}, format="json")
    first = client.patch(detail, {"name": "Checkout", "expected_version": 1}, format="json")
    stale = client.patch(detail, {"name": "Stale", "expected_version": 1}, format="json")
    before = first.data["filters"]
    changed = client.post(
        f"{detail}set_rollout_percentage/",
        {"condition_index": 0, "rollout_percentage": 25, "expected_version": first.data["version"]},
        format="json",
    )

    assert missing_version.status_code == 400
    assert missing_version.data == {"expected_version": ["This field is required."]}
    assert stale.status_code == 409
    assert stale.data["code"] == "version_conflict"
    assert changed.status_code == 200
    assert changed.data["filters"]["groups"][0]["rollout_percentage"] == 25
    assert changed.data["filters"]["groups"][0]["properties"] == before["groups"][0]["properties"]
    assert changed.data["filters"]["groups"][1] == before["groups"][1]
    assert changed.data["filters"]["multivariate"] == before["multivariate"]
    assert changed.data["filters"]["payloads"] == before["payloads"]


def test_rollout_plan_concurrency_rejects_stale_and_delete_recreate_aba_tokens() -> None:
    team = Team.objects.create(name="Growth")
    user = User.objects.create_user(username="agent-owner")
    flag = _flag(team)
    _token, raw = _issue(team, user, scopes=["feature_flag:write"])
    client = _client(raw)
    url = f"/api/projects/{team.pk}/feature_flags/{flag.pk}/rollout_plan/"
    payload: dict[str, Any] = {
        "expected_plan_id": None,
        "expected_version": None,
        "status": "DRAFT",
        "managed_group_index": 0,
        "phases": [
            {"percentage": 10, "min_duration_minutes": 5},
            {"percentage": 50, "min_duration_minutes": 10},
        ],
        "guardrail": {
            "name": "latency",
            "comparison": "lt",
            "threshold": 300,
            "window_minutes": 15,
            "min_samples": 100,
            "max_hold_minutes": 30,
        },
    }
    created = client.put(url, payload, format="json")
    old_token = {"expected_plan_id": created.data["id"], "expected_version": created.data["version"]}
    updated = client.put(url, {**payload, **old_token, "status": "PAUSED"}, format="json")
    stale = client.put(url, {**payload, **old_token}, format="json")
    stale_invalid = client.put(
        url,
        {
            **payload,
            **old_token,
            "phases": [
                {"percentage": 50, "min_duration_minutes": 5},
                {"percentage": 10, "min_duration_minutes": 10},
            ],
        },
        format="json",
    )
    deleted = client.delete(f"{url}?expected_plan_id={updated.data['id']}&expected_version={updated.data['version']}")
    recreated = client.put(url, payload, format="json")
    aba = client.delete(
        f"{url}?expected_plan_id={old_token['expected_plan_id']}&expected_version={old_token['expected_version']}"
    )

    assert created.status_code == 201
    assert updated.status_code == 200
    assert updated.data["version"] == created.data["version"] + 1
    assert stale.status_code == 409
    assert stale_invalid.status_code == 409
    assert stale_invalid.data["current_version"] == updated.data["version"]
    assert deleted.status_code == 204
    assert recreated.status_code == 201
    assert recreated.data["id"] != created.data["id"]
    assert aba.status_code == 409
    assert aba.data["current_plan_id"] == recreated.data["id"]
