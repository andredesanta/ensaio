from dataclasses import asdict
from typing import Any, Protocol, cast

from django.db import transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.functional import cached_property
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.request import Request
from rest_framework.response import Response

from products.feature_flags.backend.evaluation import evaluate_feature_flag
from products.feature_flags.backend.models import FeatureFlag, RolloutPlan, Team
from products.feature_flags.backend.rollout_services import (
    InvalidManagedGroupError,
    set_managed_rollout_percentage,
)
from products.feature_flags.backend.serializers import (
    EvaluationResultSerializer,
    FeatureFlagSerializer,
    GuardrailSampleSerializer,
    RolloutPlanSerializer,
    TraceRequestSerializer,
)


class _HasDRFRequest(Protocol):
    request: Request


class ManagedGroupConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This rollout percentage is managed by the rollout plan. Update the plan instead."
    default_code = "managed_by_rollout_plan"


def _managed_percentage(filters: object, group_index: int) -> float | None:
    if not isinstance(filters, dict):
        return None
    groups = filters.get("groups")
    if not isinstance(groups, list) or group_index >= len(groups):
        return None
    group = groups[group_index]
    if not isinstance(group, dict):
        return None
    percentage = group.get("rollout_percentage", 100)
    return float(percentage) if isinstance(percentage, int | float) else None


class TeamScopedViewSetMixin:
    """Make the project id in the URL an unavoidable queryset boundary."""

    kwargs: dict[str, Any]
    queryset: QuerySet[FeatureFlag]

    @cached_property
    def team(self) -> Team:
        return get_object_or_404(Team, pk=self.kwargs["team_id"])

    def get_queryset(self) -> QuerySet[FeatureFlag]:
        return self.queryset.filter(team_id=self.kwargs["team_id"], deleted=False)

    def get_serializer_context(self) -> dict[str, Any]:
        request = cast(_HasDRFRequest, self).request
        return {
            "request": request,
            "format": self.kwargs.get("format"),
            "view": self,
            "team": self.team,
        }

    def perform_create(self, serializer: serializers.BaseSerializer[FeatureFlag]) -> None:
        request = cast(_HasDRFRequest, self).request
        serializer.save(team=self.team, created_by=request.user)


class FeatureFlagViewSet(TeamScopedViewSetMixin, viewsets.ModelViewSet[FeatureFlag]):
    queryset = FeatureFlag.objects.select_related("created_by", "rollout_plan")
    serializer_class = FeatureFlagSerializer

    def perform_destroy(self, instance: FeatureFlag) -> None:
        instance.deleted = True
        instance.save(update_fields={"deleted"})

    def perform_update(self, serializer: serializers.BaseSerializer[FeatureFlag]) -> None:
        instance = cast(FeatureFlag, serializer.instance)
        filters = serializer.validated_data.get("filters")
        if filters is not None:
            plan = RolloutPlan.objects.filter(flag=instance).only("managed_group_index").first()
            if plan is not None:
                before = _managed_percentage(instance.filters, plan.managed_group_index)
                after = _managed_percentage(filters, plan.managed_group_index)
                if before != after:
                    raise ManagedGroupConflict()
        serializer.save()

    @extend_schema(request=TraceRequestSerializer, responses=EvaluationResultSerializer)
    @action(detail=True, methods=["post"])
    def trace(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        flag = self.get_object()
        request_serializer = TraceRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        input_data = request_serializer.validated_data
        result = evaluate_feature_flag(
            flag,
            distinct_id=cast(str, input_data["distinct_id"]),
            properties=cast(dict[str, object], input_data["properties"]),
        )
        response_serializer = EvaluationResultSerializer(asdict(result))
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @extend_schema(responses={200: RolloutPlanSerializer, 404: OpenApiResponse(description="No rollout plan.")})
    @action(detail=True, methods=["get"], url_path="rollout_plan")
    def rollout_plan(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        flag = self.get_object()
        plan = get_object_or_404(RolloutPlan, flag=flag)
        return Response(RolloutPlanSerializer(plan).data)

    @extend_schema(
        request=RolloutPlanSerializer,
        responses={200: RolloutPlanSerializer, 201: RolloutPlanSerializer},
    )
    @rollout_plan.mapping.put
    def update_rollout_plan(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        flag = self.get_object()
        with transaction.atomic():
            locked_flag = get_object_or_404(
                FeatureFlag.objects.select_for_update(),
                pk=flag.pk,
                team_id=self.kwargs["team_id"],
                deleted=False,
            )
            plan = RolloutPlan.objects.select_for_update().filter(flag=locked_flag).first()
            serializer = RolloutPlanSerializer(
                plan,
                data=request.data,
                context={**self.get_serializer_context(), "flag": locked_flag},
            )
            serializer.is_valid(raise_exception=True)
            created = plan is None
            plan = serializer.save(flag=locked_flag)

            try:
                if plan.status == RolloutPlan.Status.ACTIVE:
                    phase = cast(list[dict[str, Any]], plan.phases)[plan.current_phase_index]
                    set_managed_rollout_percentage(locked_flag, plan, float(phase["percentage"]))
                    plan.phase_entered_at = timezone.now()
                    plan.hold_reason = ""
                    plan.hold_started_at = None
                    plan.save(update_fields={"phase_entered_at", "hold_reason", "hold_started_at"})
                elif plan.status == RolloutPlan.Status.REVERTED:
                    set_managed_rollout_percentage(locked_flag, plan, 0)
                    plan.hold_reason = "manual_revert"
                    plan.hold_started_at = None
                    plan.save(update_fields={"hold_reason", "hold_started_at"})
            except InvalidManagedGroupError as error:
                raise ManagedGroupConflict(str(error)) from error

        response_serializer = RolloutPlanSerializer(plan)
        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(response_serializer.data, status=response_status)

    @extend_schema(responses={204: OpenApiResponse(description="Rollout plan deleted.")})
    @rollout_plan.mapping.delete
    def delete_rollout_plan(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        flag = self.get_object()
        plan = get_object_or_404(RolloutPlan, flag=flag)
        plan.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=GuardrailSampleSerializer, responses={201: GuardrailSampleSerializer})
    @action(detail=True, methods=["post"], url_path="guardrail_samples")
    def guardrail_samples(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        flag = self.get_object()
        plan = get_object_or_404(RolloutPlan, flag=flag)
        serializer = GuardrailSampleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sample = serializer.save(plan=plan)
        return Response(GuardrailSampleSerializer(sample).data, status=status.HTTP_201_CREATED)
