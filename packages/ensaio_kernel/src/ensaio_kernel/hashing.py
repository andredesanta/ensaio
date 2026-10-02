import hashlib
from collections.abc import Sequence

from ensaio_kernel.types import Variant

LONG_SCALE = 0xFFFFFFFFFFFFFFF


def calculate_hash(prefix: str, identifier: str, salt: str = "") -> float:
    """Return PostHog's deterministic 60-bit SHA-1 position in ``[0, 1]``.

    ``prefix`` is deliberately separate from ``identifier``. PostHog's own
    Rust vectors use ``holdout-`` while normal flag evaluation uses
    ``f"{flag_key}."``. One function must prove both paths use the same
    arithmetic.
    """

    digest = hashlib.sha1(f"{prefix}{identifier}{salt}".encode()).hexdigest()
    return int(digest[:15], 16) / LONG_SCALE


def hash_position(flag_key: str, distinct_id: str, salt: str = "") -> float:
    """Hash one subject for rollout or variant assignment on one flag.

    PostHog uses zero as a sentinel when identity selection yields an empty
    identifier, instead of hashing the flag prefix and salt.
    """

    if not distinct_id:
        return 0.0
    return calculate_hash(f"{flag_key}.", distinct_id, salt)


def is_in_rollout(percentage: float, position: float | None) -> bool:
    """Apply PostHog's rollout boundary, including its 100% hash bypass.

    Callers pass ``None`` only at 100%. Keeping the shortcut visible in this
    pure helper prevents a future refactor from hashing when PostHog does not.
    """

    if percentage == 100:
        return True
    if position is None:
        raise ValueError("a hash position is required below 100% rollout")
    return position <= percentage / 100


def select_variant(position: float, variants: Sequence[Variant]) -> str | None:
    """Return the first variant whose cumulative weight is greater than the hash."""

    cumulative_percentage = 0.0
    for variant in variants:
        cumulative_percentage += variant.rollout_percentage / 100
        if position < cumulative_percentage:
            return variant.key
    return None
