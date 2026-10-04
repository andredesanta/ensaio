from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient

from products.feature_flags.backend.definitions_cache import definitions_cache_key
from products.feature_flags.backend.models import FeatureFlag, GuardrailSample, RolloutPlan, Team
from products.feature_flags.backend.rollout_services import tick_rollout_plan

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
    holding_version = plan.version

    call_command("tick_rollouts")
    plan.refresh_from_db()
    assert plan.version == holding_version

    plan.hold_started_at = timezone.now() - timedelta(minutes=30)
    plan.save(update_fields={"hold_started_at"})
    call_command("tick_rollouts")
    flag.refresh_from_db()
    plan.refresh_from_db()

    assert plan.status == RolloutPlan.Status.PAUSED
    assert plan.hold_reason == "max_hold_exceeded"
    assert flag.filters["groups"][0]["rollout_percentage"] == 10
    assert flag.version == 1


def test_concurrent_plan_replace_and_tick_finish_without_deadlock_in_one_lock_order() -> None:
    flag, plan = _plan()
    _sample(plan)
    user = User.objects.create_user(username="concurrent-replace")
    barrier = Barrier(2)

    def tick() -> str:
        close_old_connections()
        barrier.wait()
        decision = tick_rollout_plan(plan.pk, timezone.now())
        close_old_connections()
        return type(decision).__name__

    def replace() -> int:
        close_old_connections()
        client = APIClient()
        client.force_authenticate(user=user)
        barrier.wait()
        response = client.put(
            f"/api/projects/{flag.team_id}/feature_flags/{flag.pk}/rollout_plan/",
            {
                "expected_plan_id": plan.pk,
                "expected_version": plan.version,
                "status": "PAUSED",
                "managed_group_index": plan.managed_group_index,
                "phases": plan.phases,
                "guardrail": plan.guardrail,
            },
            format="json",
        )
        close_old_connections()
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        tick_future = executor.submit(tick)
        replace_future = executor.submit(replace)
        tick_result = tick_future.result(timeout=10)
        replace_status = replace_future.result(timeout=10)

    assert tick_result in {"Advance", "Wait"}
    assert replace_status in {200, 409}
    assert RolloutPlan.objects.filter(pk=plan.pk, flag=flag).exists()


def test_concurrent_plan_delete_and_tick_finish_without_deadlock_or_cross_row_write() -> None:
    flag, plan = _plan()
    _sample(plan)
    user = User.objects.create_user(username="concurrent-delete")
    barrier = Barrier(2)

    def tick() -> str:
        close_old_connections()
        barrier.wait()
        decision = tick_rollout_plan(plan.pk, timezone.now())
        close_old_connections()
        return type(decision).__name__

    def delete() -> int:
        close_old_connections()
        client = APIClient()
        client.force_authenticate(user=user)
        barrier.wait()
        response = client.delete(
            f"/api/projects/{flag.team_id}/feature_flags/{flag.pk}/rollout_plan/"
            f"?expected_plan_id={plan.pk}&expected_version={plan.version}"
        )
        close_old_connections()
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        tick_future = executor.submit(tick)
        delete_future = executor.submit(delete)
        tick_result = tick_future.result(timeout=10)
        delete_status = delete_future.result(timeout=10)

    assert tick_result in {"Advance", "Wait"}
    assert delete_status in {204, 409}
    assert FeatureFlag.objects.filter(pk=flag.pk).exists()
