from pathlib import Path
from typing import Any, cast

import pytest
from django.core.cache import cache
from django.db import transaction
from rest_framework.test import APIClient

from ensaio_kernel import FlagDefinition, evaluate
from products.feature_flags.backend.definitions import calculate_definitions_etag
from products.feature_flags.backend.definitions_cache import definitions_cache_key
from products.feature_flags.backend.models import FeatureFlag, Team
from products.feature_flags.backend.tests.golden_vectors import GOLDEN_VECTOR_PATHS, load_vector

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _clear_definitions_cache() -> None:
    cache.clear()


def _team_and_secret() -> tuple[Team, str]:
    team = Team.objects.create(name="Growth")
    secret = team.issue_secret_api_token()
    team.save(update_fields={"secret_api_token"})
    return team, secret


def _get_definitions(client: APIClient, secret: str, *, etag: str | None = None) -> Any:
    headers = {"Authorization": f"Bearer {secret}"}
    if etag is not None:
        headers["If-None-Match"] = etag
    return client.get("/flags/definitions", headers=headers)


def test_definitions_require_a_valid_team_secret_bearer_token() -> None:
    team, _secret = _team_and_secret()
    client = APIClient()

    missing = client.get("/flags/definitions")
    wrong_scheme = client.get("/flags/definitions", HTTP_AUTHORIZATION=f"Token {team.api_token}")
    public_token = client.get("/flags/definitions", HTTP_AUTHORIZATION=f"Bearer {team.api_token}")
    wrong_secret = client.get("/flags/definitions", HTTP_AUTHORIZATION="Bearer ens_sec_wrong")

    for response in (missing, wrong_scheme, public_token, wrong_secret):
        assert response.status_code == 401
        assert response.data == {"detail": "Invalid API token."}
        assert response["WWW-Authenticate"] == "Bearer"


def test_definitions_return_live_flags_including_inactive_flags_for_local_evaluation() -> None:
    team, secret = _team_and_secret()
    other_team = Team.objects.create(name="Other")
    active = FeatureFlag.objects.create(
        team=team,
        key="active",
        filters={"groups": [{"properties": [], "rollout_percentage": 100, "variant": None}]},
    )
    inactive = FeatureFlag.objects.create(team=team, key="inactive", active=False)
    FeatureFlag.objects.create(team=team, key="deleted", deleted=True)
    FeatureFlag.objects.create(team=other_team, key="other-team")

    response = _get_definitions(APIClient(), secret)

    assert response.status_code == 200
    assert response["Cache-Control"] == "private, must-revalidate"
    assert "authorization" in {value.strip().lower() for value in response["Vary"].split(",")}
    assert response["ETag"].startswith('"')
    assert response["ETag"].endswith('"')
    assert response.data == {
        "flags": [
            {
                "key": active.key,
                "active": True,
                "filters": active.filters,
                "version": 1,
            },
            {
                "key": inactive.key,
                "active": False,
                "filters": inactive.filters,
                "version": 1,
            },
        ]
    }


def test_matching_etag_returns_an_empty_304_response() -> None:
    _team, secret = _team_and_secret()
    first = _get_definitions(APIClient(), secret)

    not_modified = _get_definitions(APIClient(), secret, etag=first["ETag"])

    assert not_modified.status_code == 304
    assert not_modified.content == b""
    assert not_modified["ETag"] == first["ETag"]
    assert not_modified["Cache-Control"] == "private, must-revalidate"

    weak_not_modified = _get_definitions(APIClient(), secret, etag=f"W/{first['ETag']}")

    assert weak_not_modified.status_code == 304


def test_flag_create_update_and_soft_delete_invalidate_the_cached_snapshot() -> None:
    team, secret = _team_and_secret()
    client = APIClient()
    empty = _get_definitions(client, secret)

    flag = FeatureFlag.objects.create(team=team, key="checkout")
    created = _get_definitions(client, secret, etag=empty["ETag"])

    flag.name = "Checkout v2"
    flag.save(update_fields={"name"})
    updated = _get_definitions(client, secret, etag=created["ETag"])

    flag.deleted = True
    flag.save(update_fields={"deleted"})
    deleted = _get_definitions(client, secret, etag=updated["ETag"])

    assert created.status_code == 200
    assert created.data["flags"][0]["version"] == 1
    assert updated.status_code == 200
    assert updated.data["flags"][0]["version"] == 2
    assert deleted.status_code == 200
    assert deleted.data == {"flags": []}
    assert len({empty["ETag"], created["ETag"], updated["ETag"]}) == 3
    assert deleted["ETag"] == empty["ETag"]


def test_cache_invalidation_waits_for_the_database_commit() -> None:
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(team=team, key="checkout")
    cache_key = definitions_cache_key(team.pk)
    cache.set(cache_key, "cached-before-update", timeout=None)

    with transaction.atomic():
        flag.name = "Checkout v2"
        flag.save(update_fields={"name"})
        assert cache.get(cache_key) == "cached-before-update"

    assert cache.get(cache_key) is None


def test_etag_is_stable_for_sorted_versions_and_scoped_by_team() -> None:
    forward = calculate_definitions_etag(1, [(10, 2), (20, 4)])
    reversed_pairs = calculate_definitions_etag(1, [(20, 4), (10, 2)])

    assert forward == reversed_pairs
    assert forward != calculate_definitions_etag(2, [(10, 2), (20, 4)])
    assert forward != calculate_definitions_etag(1, [(10, 3), (20, 4)])


@pytest.mark.parametrize("path", GOLDEN_VECTOR_PATHS, ids=lambda path: path.stem)
def test_downloaded_definitions_reproduce_every_golden_vector_locally(path: Path) -> None:
    vector = load_vector(path)
    raw_flag = vector["flag"]
    team, secret = _team_and_secret()
    FeatureFlag.objects.create(
        team=team,
        key=raw_flag["key"],
        active=raw_flag["active"],
        version=raw_flag["version"],
        filters=raw_flag["filters"],
    )

    response = _get_definitions(APIClient(), secret)

    assert response.status_code == 200
    downloaded = cast(dict[str, Any], response.data["flags"][0])
    result = evaluate(
        FlagDefinition(
            key=cast(str, downloaded["key"]),
            active=cast(bool, downloaded["active"]),
            filters=cast(dict[str, object], downloaded["filters"]),
            version=cast(int, downloaded["version"]),
        ),
        vector["distinct_id"],
        vector["properties"],
    )
    assert result.enabled is vector["expected"]["enabled"]
    assert result.variant == vector["expected"]["variant"]
    assert result.payload == vector["expected"]["payload"]
    assert result.reason == vector["expected"]["reason"]
    assert result.condition_index == vector["expected"]["condition_index"]
