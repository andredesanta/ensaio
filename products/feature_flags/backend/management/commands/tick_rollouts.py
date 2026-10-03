import structlog
from django.core.management.base import BaseCommand
from django.utils import timezone

from products.feature_flags.backend.models import RolloutPlan
from products.feature_flags.backend.rollout_services import tick_rollout_plan

logger = structlog.get_logger(__name__)


class Command(BaseCommand):
    help = "Evaluate every active or holding rollout plan once."

    def handle(self, *args: object, **options: object) -> None:
        plan_ids = list(
            RolloutPlan.objects.filter(status__in=(RolloutPlan.Status.ACTIVE, RolloutPlan.Status.HOLDING))
            .order_by("id")
            .values_list("id", flat=True)
        )
        now = timezone.now()

        for plan_id in plan_ids:
            decision = tick_rollout_plan(plan_id, now)
            logger.info(
                "rollout_plan_ticked",
                plan_id=plan_id,
                decision=type(decision).__name__.lower(),
            )

        self.stdout.write(self.style.SUCCESS(f"Ticked {len(plan_ids)} rollout plan(s)."))
