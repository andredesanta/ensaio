from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any, cast

from django.db import transaction

from products.feature_flags.backend.models import FeatureFlag, GuardrailSample, RolloutPlan
from products.feature_flags.backend.rollouts import (
    Advance,
    Complete,
    Decision,
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


class InvalidManagedGroupError(ValueError):
    pass


def set_managed_rollout_percentage(flag: FeatureFlag, plan: RolloutPlan, percentage: float) -> None:
    filters = deepcopy(flag.filters)
    groups = filters.get("groups") if isinstance(filters, dict) else None
    if not isinstance(groups, list) or plan.managed_group_index >= len(groups):
        raise InvalidManagedGroupError("The rollout plan's managed group no longer exists.")
    group = groups[plan.managed_group_index]
    if not isinstance(group, dict):
        raise InvalidManagedGroupError("The rollout plan's managed group is malformed.")
    group["rollout_percentage"] = percentage
    flag.filters = filters
    flag.save(update_fields={"filters"})


def _plan_state(plan: RolloutPlan) -> PlanState:
    raw_phases = cast(list[dict[str, Any]], plan.phases)
    raw_guardrail = cast(dict[str, Any], plan.guardrail)
    return PlanState(
        phases=tuple(
            Phase(
                percentage=float(phase["percentage"]),
                min_duration_minutes=int(phase["min_duration_minutes"]),
            )
            for phase in raw_phases
        ),
        current_phase_index=plan.current_phase_index,
        phase_entered_at=plan.phase_entered_at,
        hold_started_at=plan.hold_started_at,
        guardrail=Guardrail(
            name=str(raw_guardrail["name"]),
            comparison=cast(GuardrailComparison, raw_guardrail["comparison"]),
            threshold=float(raw_guardrail["threshold"]),
            window_minutes=int(raw_guardrail["window_minutes"]),
            min_samples=int(raw_guardrail["min_samples"]),
            max_hold_minutes=int(raw_guardrail["max_hold_minutes"]),
        ),
    )


def _samples(plan: RolloutPlan, state: PlanState, now: datetime) -> tuple[Sample, ...]:
    window_start = now - timedelta(minutes=state.guardrail.window_minutes)
    return tuple(
        Sample(recorded_at=sample.recorded_at, value=sample.value, sample_count=sample.sample_count)
        for sample in GuardrailSample.objects.filter(
            plan=plan,
            recorded_at__gte=window_start,
            recorded_at__lte=now,
            sample_count__gte=state.guardrail.min_samples,
        ).only("recorded_at", "value", "sample_count")
    )


def tick_rollout_plan(plan_id: int, now: datetime) -> Decision:
    """Lock, decide, and apply one plan atomically."""

    flag_id = RolloutPlan.objects.filter(pk=plan_id).values_list("flag_id", flat=True).first()
    if flag_id is None:
        return Wait()

    with transaction.atomic():
        flag = FeatureFlag.objects.select_for_update().filter(pk=flag_id).first()
        if flag is None:
            return Wait()
        plan = RolloutPlan.objects.select_for_update().filter(pk=plan_id, flag_id=flag.pk).first()
        if plan is None:
            return Wait()
        if plan.status not in {RolloutPlan.Status.ACTIVE, RolloutPlan.Status.HOLDING}:
            return Wait()
        state = _plan_state(plan)
        decision = decide(state, _samples(plan, state, now), now)

        if isinstance(decision, Wait):
            return decision

        update_fields = {"status", "hold_reason", "hold_started_at"}
        if isinstance(decision, Advance):
            phase = cast(list[dict[str, Any]], plan.phases)[decision.next_index]
            set_managed_rollout_percentage(flag, plan, float(phase["percentage"]))
            plan.status = RolloutPlan.Status.ACTIVE
            plan.current_phase_index = decision.next_index
            plan.phase_entered_at = now
            plan.hold_reason = ""
            plan.hold_started_at = None
            update_fields.update({"current_phase_index", "phase_entered_at"})
        elif isinstance(decision, Complete):
            plan.status = RolloutPlan.Status.COMPLETED
            plan.hold_reason = ""
            plan.hold_started_at = None
        elif isinstance(decision, Hold):
            if (
                plan.status == RolloutPlan.Status.HOLDING
                and plan.hold_reason == decision.reason
                and plan.hold_started_at is not None
            ):
                return decision
            plan.status = RolloutPlan.Status.HOLDING
            plan.hold_reason = decision.reason
            if plan.hold_started_at is None:
                plan.hold_started_at = now
        elif isinstance(decision, Pause):
            plan.status = RolloutPlan.Status.PAUSED
            plan.hold_reason = decision.reason
        elif isinstance(decision, Revert):
            set_managed_rollout_percentage(flag, plan, 0)
            plan.status = RolloutPlan.Status.REVERTED
            plan.hold_reason = decision.reason
            plan.hold_started_at = None

        plan.save(update_fields=update_fields)
        return decision
