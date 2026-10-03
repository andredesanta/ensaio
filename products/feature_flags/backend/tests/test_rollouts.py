from datetime import UTC, datetime, timedelta

import pytest

from products.feature_flags.backend.rollouts import (
    GUARDRAIL_BREACHED,
    INSUFFICIENT_DATA,
    MAX_HOLD_EXCEEDED,
    Advance,
    Complete,
    Guardrail,
    GuardrailComparison,
    Hold,
    Pause,
    Phase,
    PlanState,
    Revert,
    Sample,
    Wait,
    decide,
)

NOW = datetime(2026, 10, 2, 12, tzinfo=UTC)


def _plan(
    *,
    current_phase_index: int = 0,
    phase_entered_at: datetime = NOW - timedelta(minutes=11),
    hold_started_at: datetime | None = None,
    comparison: GuardrailComparison = "lt",
) -> PlanState:
    return PlanState(
        phases=(
            Phase(percentage=10, min_duration_minutes=10),
            Phase(percentage=50, min_duration_minutes=10),
        ),
        current_phase_index=current_phase_index,
        phase_entered_at=phase_entered_at,
        hold_started_at=hold_started_at,
        guardrail=Guardrail(
            name="error_rate",
            comparison=comparison,
            threshold=0.02,
            window_minutes=15,
            min_samples=100,
            max_hold_minutes=30,
        ),
    )


def _sample(
    value: float = 0.01,
    *,
    recorded_at: datetime = NOW - timedelta(minutes=1),
    sample_count: int = 100,
) -> Sample:
    return Sample(recorded_at=recorded_at, value=value, sample_count=sample_count)


def test_phase_cannot_advance_before_its_minimum_duration() -> None:
    decision = decide(_plan(phase_entered_at=NOW - timedelta(minutes=9)), [_sample(value=1)], NOW)

    assert decision == Wait()


def test_healthy_evidence_advances_then_completes_the_rollout() -> None:
    assert decide(_plan(), [_sample()], NOW) == Advance(next_index=1)
    assert decide(_plan(current_phase_index=1), [_sample()], NOW) == Complete()


def test_missing_guardrail_data_never_advances() -> None:
    assert decide(_plan(), [], NOW) == Hold(INSUFFICIENT_DATA)
    assert decide(_plan(), [_sample(sample_count=99)], NOW) == Hold(INSUFFICIENT_DATA)
    assert decide(_plan(), [_sample(recorded_at=NOW - timedelta(minutes=16))], NOW) == Hold(INSUFFICIENT_DATA)


def test_missing_data_pauses_after_the_maximum_hold_duration() -> None:
    plan = _plan(hold_started_at=NOW - timedelta(minutes=30))

    assert decide(plan, [], NOW) == Pause(MAX_HOLD_EXCEEDED)


def test_a_breach_wins_when_other_samples_have_insufficient_data() -> None:
    samples = [_sample(value=0.03), _sample(value=0.01, sample_count=1)]

    assert decide(_plan(), samples, NOW) == Revert(GUARDRAIL_BREACHED)


@pytest.mark.parametrize(
    ("comparison", "healthy", "breached"),
    [
        ("lt", 0.019, 0.02),
        ("lte", 0.02, 0.021),
        ("gt", 0.021, 0.02),
        ("gte", 0.02, 0.019),
    ],
)
def test_guardrail_comparison_describes_the_healthy_side(
    comparison: GuardrailComparison,
    healthy: float,
    breached: float,
) -> None:
    assert decide(_plan(comparison=comparison), [_sample(value=healthy)], NOW) == Advance(next_index=1)
    assert decide(_plan(comparison=comparison), [_sample(value=breached)], NOW) == Revert(GUARDRAIL_BREACHED)
