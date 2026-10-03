from functools import partial

from django.core.cache import cache
from django.db import transaction

DEFINITIONS_CACHE_KEY_PREFIX = "feature_flag_definitions"


def definitions_cache_key(team_id: int) -> str:
    return f"{DEFINITIONS_CACHE_KEY_PREFIX}:{team_id}"


def invalidate_definitions_cache(team_id: int) -> None:
    cache.delete(definitions_cache_key(team_id))


def schedule_definitions_cache_invalidation(team_id: int) -> None:
    """Invalidate only after the flag write is visible to other requests."""

    transaction.on_commit(partial(invalidate_definitions_cache, team_id))
