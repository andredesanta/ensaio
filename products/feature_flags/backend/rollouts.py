from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

type GuardrailComparison = Literal["lt", "lte", "gt", "gte"]


@dataclass(frozen=True, slots=True)
class Phase:
    percentage: float
    min_duration_minutes: int


@dataclass(frozen=True, slots=True)
class Guardrail:
    name: str
    comparison: GuardrailComparison
    threshold: float
    window_minutes: int
    min_samples: int
    max_hold_minutes: int


@dataclass(frozen=True, slots=True)
class PlanState:
    phases: tuple[Phase, ...]
    current_phase_index: int
    phase_entered_at: datetime
    hold_started_at: datetime | None
    guardrail: Guardrail


@dataclass(frozen=True, slots=True)
class Sample:
    recorded_at: datetime
    value: float
    sample_count: int


@dataclass(frozen=True, slots=True)
class Advance:
    next_index: int


@dataclass(frozen=True, slots=True)
class Complete:
    pass


@dataclass(frozen=True, slots=True)
class Hold:
    reason: str


@dataclass(frozen=True, slots=True)
class Pause:
    reason: str


@dataclass(frozen=True, slots=True)
class Revert:
    reason: str


@dataclass(frozen=True, slots=True)
class Wait:
    pass


type Decision = Advance | Complete | Hold | Pause | Revert | Wait

INSUFFICIENT_DATA = "insufficient_guardrail_data"
GUARDRAIL_BREACHED = "guardrail_breached"
MAX_HOLD_EXCEEDED = "max_hold_exceeded"


def _breaches_guardrail(value: float, comparison: GuardrailComparison, threshold: float) -> bool:
    if comparison == "lt":
        return value >= threshold
    if comparison == "lte":
        return value > threshold
    if comparison == "gt":
        return value <= threshold
    return value < threshold


def decide(plan: PlanState, samples: Sequence[Sample], now: datetime) -> Decision:
    """Choose one rollout transition without performing I/O or reading a clock."""

    phase = plan.phases[plan.current_phase_index]
    if now - plan.phase_entered_at < timedelta(minutes=phase.min_duration_minutes):
        return Wait()

    window_start = now - timedelta(minutes=plan.guardrail.window_minutes)
    evidence = tuple(
        sample
        for sample in samples
        if window_start <= sample.recorded_at <= now and sample.sample_count >= plan.guardrail.min_samples
    )

    if any(
        _breaches_guardrail(sample.value, plan.guardrail.comparison, plan.guardrail.threshold) for sample in evidence
    ):
        return Revert(GUARDRAIL_BREACHED)

    if not evidence:
        if plan.hold_started_at is not None and now - plan.hold_started_at >= timedelta(
            minutes=plan.guardrail.max_hold_minutes
        ):
            return Pause(MAX_HOLD_EXCEEDED)
        return Hold(INSUFFICIENT_DATA)

    if plan.current_phase_index == len(plan.phases) - 1:
        return Complete()
    return Advance(plan.current_phase_index + 1)
