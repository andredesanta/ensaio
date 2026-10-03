import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TypedDict, cast

from django.core.cache import cache

from products.feature_flags.backend.definitions_cache import definitions_cache_key
from products.feature_flags.backend.models import SECRET_TOKEN_PREFIX, FeatureFlag, Team


class FlagDefinitionPayload(TypedDict):
    key: str
    active: bool
    filters: dict[str, object]
    version: int


class DefinitionsPayload(TypedDict):
    flags: list[FlagDefinitionPayload]


@dataclass(frozen=True, slots=True)
class DefinitionsSnapshot:
    etag: str
    payload: DefinitionsPayload


def calculate_definitions_etag(team_id: int, versions: Sequence[tuple[int, int]]) -> str:
    """Fingerprint the team and sorted live flag identity/version pairs."""

    material = f"{team_id}:" + ",".join(f"{flag_id}:{version}" for flag_id, version in sorted(versions))
    digest = hashlib.sha256(material.encode()).hexdigest()
    return f'"{digest}"'


def get_definitions_snapshot(team: Team) -> DefinitionsSnapshot:
    cache_key = definitions_cache_key(team.pk)
    cached = cache.get(cache_key)
    if isinstance(cached, DefinitionsSnapshot):
        return cached

    flags = list(
        FeatureFlag.objects.filter(team=team, deleted=False)
        .only("id", "key", "active", "filters", "version")
        .order_by("id")
    )
    payload: DefinitionsPayload = {
        "flags": [
            {
                "key": flag.key,
                "active": flag.active,
                "filters": cast(dict[str, object], flag.filters),
                "version": flag.version,
            }
            for flag in flags
        ]
    }
    snapshot = DefinitionsSnapshot(
        etag=calculate_definitions_etag(team.pk, [(flag.pk, flag.version) for flag in flags]),
        payload=payload,
    )
    cache.set(cache_key, snapshot, timeout=None)
    return snapshot


def find_team_by_secret_token(token: str) -> Team | None:
    """Resolve a hashed secret token without ever storing or logging its raw value."""

    if not token.startswith(SECRET_TOKEN_PREFIX):
        return None

    for team in Team.objects.only("id", "name", "api_token", "secret_api_token").iterator():
        if team.check_secret_api_token(token):
            return team
    return None
