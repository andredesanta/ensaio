from datetime import timedelta

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone

from products.feature_flags.backend.definitions_cache import definitions_cache_key
from products.feature_flags.backend.models import FeatureFlag, GuardrailSample, RolloutPlan, Team

pytestmark = pytest.mark.django_db(transaction=True)


def _plan(
    *,
    first_percentage: float = 10,
    status: str = RolloutPlan.Status.ACTIVE,
) -> tuple[FeatureFlag, RolloutPlan]:
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(
        team=team,
        key="checkout",
        filters={
            "groups": [
                {"properties": [], "rollout_percentage": first_percentage, "variant": None},
                {"properties": [], "rollout_percentage": 80, "variant": None},
            ]
        },
    )
    plan = RolloutPlan.objects.create(
        flag=flag,
        status=status,
        managed_group_index=0,
        phases=[
            {"percentage": 10, "min_duration_minutes": 5},
            {"percentage": 50, "min_duration_minutes": 5},
        ],
        current_phase_index=0,
        phase_entered_at=timezone.now() - timedelta(minutes=6),
        guardrail={
            "name": "error_rate",
            "comparison": "lt",
            "threshold": 0.02,
            "window_minutes": 15,
            "min_samples": 100,
            "max_hold_minutes": 30,
        },
    )
    return flag, plan


def _sample(plan: RolloutPlan, *, value: float = 0.01, sample_count: int = 100) -> None:
    GuardrailSample.objects.create(plan=plan, value=value, sample_count=sample_count)


def test_healthy_evidence_advances_then_completes_without_touching_other_groups() -> None:
    flag, plan = _plan()
    _sample(plan)
    cache_key = definitions_cache_key(flag.team_id)
    cache.set(cache_key, "cached-before-tick", timeout=None)

    call_command("tick_rollouts")
    flag.refresh_from_db()
    plan.refresh_from_db()

    assert plan.status == RolloutPlan.Status.ACTIVE
    assert plan.current_phase_index == 1
    assert flag.filters["groups"][0]["rollout_percentage"] == 50
    assert flag.filters["groups"][1]["rollout_percentage"] == 80
    assert flag.version == 2
    assert cache.get(cache_key) is None

    plan.phase_entered_at = timezone.now() - timedelta(minutes=6)
    plan.save(update_fields={"phase_entered_at"})
    call_command("tick_rollouts")
    flag.refresh_from_db()
    plan.refresh_from_db()

    assert plan.status == RolloutPlan.Status.COMPLETED
    assert flag.filters["groups"][0]["rollout_percentage"] == 50
    assert flag.version == 2


def test_a_breach_reverts_only_the_managed_group_and_bumps_the_flag_version() -> None:
    flag, plan = _plan()
    _sample(plan, value=0.03)

    call_command("tick_rollouts")
    flag.refresh_from_db()
    plan.refresh_from_db()

    assert plan.status == RolloutPlan.Status.REVERTED
    assert plan.hold_reason == "guardrail_breached"
    assert flag.filters["groups"][0]["rollout_percentage"] == 0
    assert flag.filters["groups"][1]["rollout_percentage"] == 80
    assert flag.active
    assert flag.version == 2


def test_missing_or_under_sampled_data_holds_then_pauses_and_never_advances() -> None:
    flag, plan = _plan()
    _sample(plan, sample_count=99)

    call_command("tick_rollouts")
    flag.refresh_from_db()
    plan.refresh_from_db()

    assert plan.status == RolloutPlan.Status.HOLDING
    assert plan.hold_reason == "insufficient_guardrail_data"
    assert plan.hold_started_at is not None
    assert flag.filters["groups"][0]["rollout_percentage"] == 10
    assert flag.version == 1

    plan.hold_started_at = timezone.now() - timedelta(minutes=30)
    plan.save(update_fields={"hold_started_at"})
    call_command("tick_rollouts")
    flag.refresh_from_db()
    plan.refresh_from_db()

    assert plan.status == RolloutPlan.Status.PAUSED
    assert plan.hold_reason == "max_hold_exceeded"
    assert flag.filters["groups"][0]["rollout_percentage"] == 10
    assert flag.version == 1
