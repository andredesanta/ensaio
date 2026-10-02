import pytest
from hypothesis import given
from hypothesis import strategies as st

from ensaio_kernel import Variant, calculate_hash, hash_position, is_in_rollout, select_variant


@pytest.mark.parametrize(
    ("identifier", "expected"),
    [
        ("some_distinct_id", 0.7270002403585725),
        ("test-identifier", 0.4493881716040236),
        ("example_id", 0.9402003475831224),
        ("example_id2", 0.6292740389966519),
    ],
)
def test_hash_matches_posthog_rust_vectors(identifier: str, expected: float) -> None:
    assert calculate_hash("holdout-", identifier) == expected


@pytest.mark.parametrize(
    ("distinct_id", "expected_rollout", "expected_variant"),
    [
        ("u_42", 0.6729059414944576, 0.18510865603197107),
        ("u_7", 0.6953144789025082, 0.8025934176866744),
        ("u_314", 0.8890033427867658, 0.9667051505877032),
    ],
)
def test_worked_example_hashes_are_reproducible(
    distinct_id: str,
    expected_rollout: float,
    expected_variant: float,
) -> None:
    assert hash_position("new-checkout", distinct_id) == expected_rollout
    assert hash_position("new-checkout", distinct_id, "variant") == expected_variant


def test_empty_identifier_uses_posthog_zero_hash_sentinel() -> None:
    assert hash_position("new-checkout", "") == 0.0
    assert hash_position("new-checkout", "", "variant") == 0.0


@given(
    flag_key=st.text(max_size=100),
    distinct_id=st.text(max_size=100),
    salt=st.text(max_size=30),
)
def test_hash_position_is_pure_and_bounded(flag_key: str, distinct_id: str, salt: str) -> None:
    first = hash_position(flag_key, distinct_id, salt)
    second = hash_position(flag_key, distinct_id, salt)

    assert first == second
    assert 0 <= first <= 1


def test_hash_positions_are_roughly_uniform_over_many_stable_ids() -> None:
    positions = [hash_position("uniformity-check", f"person-{index}") for index in range(100_000)]
    fraction_in_ten_percent = sum(position <= 0.1 for position in positions) / len(positions)
    mean = sum(positions) / len(positions)

    assert fraction_in_ten_percent == pytest.approx(0.1, abs=0.005)
    assert mean == pytest.approx(0.5, abs=0.005)


def test_full_rollout_does_not_require_a_hash() -> None:
    assert is_in_rollout(100, None)


def test_rollout_boundary_is_inclusive() -> None:
    assert is_in_rollout(25, 0.25)
    assert not is_in_rollout(25, 0.25000000000000006)


def test_variant_boundary_belongs_to_the_next_variant() -> None:
    variants = (
        Variant(key="control", rollout_percentage=50),
        Variant(key="test", rollout_percentage=50),
    )

    assert select_variant(0.49999999999999994, variants) == "control"
    assert select_variant(0.5, variants) == "test"


def test_incomplete_variant_weights_leave_remainder_unassigned() -> None:
    variants = (Variant(key="control", rollout_percentage=40),)

    assert select_variant(0.4, variants) is None
    assert select_variant(1.0, variants) is None
