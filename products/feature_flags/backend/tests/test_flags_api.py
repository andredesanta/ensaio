from pathlib import Path
from typing import Any, cast

import pytest
from rest_framework.test import APIClient

from ensaio_kernel import FlagDefinition, evaluate
from products.feature_flags.backend.models import FeatureFlag, Team
from products.feature_flags.backend.tests.golden_vectors import GOLDEN_VECTOR_PATHS, GoldenVector, load_vector

pytestmark = pytest.mark.django_db


def _post_flags(client: APIClient, team: Team, vector: GoldenVector) -> Any:
    return client.post(
        "/flags/?v=2",
        {
            "api_key": team.api_token,
            "distinct_id": vector["distinct_id"],
            "person_properties": vector["properties"],
        },
        format="json",
    )


@pytest.mark.parametrize("path", GOLDEN_VECTOR_PATHS, ids=lambda path: path.stem)
def test_flags_v2_matches_the_pure_kernel_golden_vectors(path: Path) -> None:
    vector = load_vector(path)
    raw_flag = vector["flag"]
    team = Team.objects.create(name="Golden vectors")
    flag = FeatureFlag.objects.create(
        team=team,
        key=raw_flag["key"],
        active=raw_flag["active"],
        version=raw_flag["version"],
        filters=raw_flag["filters"],
    )
    expected = evaluate(
        FlagDefinition(
            key=raw_flag["key"],
            active=raw_flag["active"],
            filters=raw_flag["filters"],
            version=raw_flag["version"],
        ),
        vector["distinct_id"],
        vector["properties"],
    )

    response = _post_flags(APIClient(), team, vector)

    assert response.status_code == 200, response.data
    assert response.data["errorsWhileComputingFlags"] is False
    response_flags = cast(dict[str, dict[str, Any]], response.data["flags"])
    if not raw_flag["active"]:
        assert raw_flag["key"] not in response_flags
        assert expected.enabled is False
        assert expected.reason == "flag_disabled"
        return

    details = response_flags[raw_flag["key"]]
    assert details["key"] == raw_flag["key"]
    assert details["enabled"] is expected.enabled
    assert details["variant"] == expected.variant
    assert details["reason"] == {
        "code": expected.reason,
        "condition_index": expected.condition_index,
    }
    assert details["metadata"] == {
        "id": flag.pk,
        "version": raw_flag["version"],
        "payload": expected.payload,
    }


def test_flags_v2_rejects_missing_or_unknown_project_tokens() -> None:
    client = APIClient()

    missing = client.post("/flags/?v=2", {"distinct_id": "u_7"}, format="json")
    unknown = client.post(
        "/flags/?v=2",
        {"api_key": "ens_pub_unknown", "distinct_id": "u_7"},
        format="json",
    )

    assert missing.status_code == 400
    assert missing.data == {"api_key": ["This field is required."]}
    assert unknown.status_code == 401
    assert unknown.data == {"detail": "Invalid API token."}


def test_flags_v2_requires_the_explicit_supported_version() -> None:
    client = APIClient()

    missing = client.post("/flags/", {}, format="json")
    unsupported = client.post("/flags/?v=1", {}, format="json")

    assert missing.status_code == 400
    assert unsupported.status_code == 400
    assert missing.data == unsupported.data == {"v": ["Only version 2 is supported."]}


def test_flags_v2_scopes_to_live_active_flags_in_the_token_team() -> None:
    team = Team.objects.create(name="Growth")
    other_team = Team.objects.create(name="Other")
    visible = FeatureFlag.objects.create(
        team=team,
        key="visible",
        filters={"groups": [{"properties": [], "rollout_percentage": 100, "variant": None}]},
    )
    FeatureFlag.objects.create(team=team, key="inactive", active=False)
    FeatureFlag.objects.create(team=team, key="deleted", deleted=True)
    FeatureFlag.objects.create(team=other_team, key="other-team")

    response = APIClient(enforce_csrf_checks=True).post(
        "/flags/?v=2",
        {"api_key": team.api_token, "distinct_id": "u_7"},
        format="json",
    )

    assert response.status_code == 200
    assert list(response.data["flags"]) == [visible.key]


def test_one_malformed_definition_does_not_fail_other_flag_results() -> None:
    team = Team.objects.create(name="Growth")
    FeatureFlag.objects.create(
        team=team,
        key="healthy",
        filters={"groups": [{"properties": [], "rollout_percentage": 100, "variant": None}]},
    )
    FeatureFlag.objects.create(team=team, key="malformed", filters={"groups": "not-a-list"})

    response = APIClient().post(
        "/flags/?v=2",
        {"api_key": team.api_token, "distinct_id": "u_7"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["errorsWhileComputingFlags"] is True
    assert list(response.data["flags"]) == ["healthy"]
