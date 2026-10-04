from copy import deepcopy
from dataclasses import asdict
from typing import Any, Protocol, cast

from django.db import transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.functional import cached_property
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response

from products.feature_flags.backend.agent_authentication import AutomationScopePermission
from products.feature_flags.backend.evaluation import evaluate_feature_flag
from products.feature_flags.backend.models import FeatureFlag, RolloutPlan, Team
from products.feature_flags.backend.rollout_services import (
    InvalidManagedGroupError,
    set_managed_rollout_percentage,
)
from products.feature_flags.backend.serializers import (
    EvaluationResultSerializer,
    FeatureFlagSerializer,
    FeatureFlagUpdateSerializer,
    FlagNotFoundSerializer,
    GuardrailSampleSerializer,
    PlanConcurrencySerializer,
    PlanMutationConcurrencySerializer,
    RolloutPlanMutationSerializer,
    RolloutPlanNotFoundSerializer,
    RolloutPlanSerializer,
    SetRolloutPercentageSerializer,
    TraceRequestSerializer,
)


class _HasDRFRequest(Protocol):
    request: Request


class ManagedGroupConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This rollout percentage is managed by the rollout plan. Update the plan instead."
    default_code = "managed_by_rollout_plan"

    def __init__(self, detail: str | None = None) -> None:
        super().__init__(detail or self.default_detail)
        self.detail = cast(
            Any,
            {
                "detail": detail or self.default_detail,
                "code": self.default_code,
            },
        )


class VersionConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "version_conflict"

    def __init__(self, current_version: int) -> None:
        super().__init__("The feature flag changed since it was read.")
        self.detail = cast(
            Any,
            {
                "detail": "The feature flag changed since it was read.",
                "code": self.default_code,
                "current_version": current_version,
            },
        )


class PlanConcurrencyConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "plan_version_conflict"

    def __init__(self, plan: RolloutPlan | None) -> None:
        super().__init__("The rollout plan changed since it was read.")
        self.detail = cast(
            Any,
            {
                "detail": "The rollout plan changed since it was read.",
                "code": self.default_code,
                "current_plan_id": plan.pk if plan is not None else None,
                "current_version": plan.version if plan is not None else None,
            },
        )


def _controlled_not_found(*, code: str, detail: str) -> Response:
    return Response({"detail": detail, "code": code}, status=status.HTTP_404_NOT_FOUND)


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


@extend_schema(
    auth=cast(Any, [{"cookieAuth": []}, {"automationBearer": []}]),
    extensions={"x-product": "feature_flags"},
)
class FeatureFlagViewSet(TeamScopedViewSetMixin, viewsets.ModelViewSet[FeatureFlag]):
    queryset = FeatureFlag.objects.select_related("created_by", "rollout_plan")
    serializer_class = FeatureFlagSerializer
    permission_classes: list[type[BasePermission]] = [AutomationScopePermission]

    def get_serializer_class(self) -> type[serializers.BaseSerializer[Any]]:
        if self.action in {"update", "partial_update"}:
            return FeatureFlagUpdateSerializer
        return FeatureFlagSerializer

    def perform_destroy(self, instance: FeatureFlag) -> None:
        instance.deleted = True
        instance.save(update_fields={"deleted"})

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        partial = bool(kwargs.pop("partial", False))
        if "expected_version" not in request.data:
            raise serializers.ValidationError({"expected_version": ["This field is required."]})
        with transaction.atomic():
            instance = get_object_or_404(
                FeatureFlag.objects.select_for_update(),
                pk=self.kwargs["pk"],
                team_id=self.kwargs["team_id"],
                deleted=False,
            )
            serializer = FeatureFlagUpdateSerializer(
                instance,
                data=request.data,
                partial=partial,
                context=self.get_serializer_context(),
            )
            serializer.is_valid(raise_exception=True)
            expected_version = cast(int, serializer.validated_data["expected_version"])
            if instance.version != expected_version:
                raise VersionConflict(instance.version)
            filters = serializer.validated_data.get("filters")
            if filters is not None:
                plan = RolloutPlan.objects.filter(flag=instance).only("managed_group_index").first()
                if plan is not None:
                    before = _managed_percentage(instance.filters, plan.managed_group_index)
                    after = _managed_percentage(filters, plan.managed_group_index)
                    if before != after:
                        raise ManagedGroupConflict()
            serializer.save()
        return Response(FeatureFlagSerializer(instance).data)

    @extend_schema(
        parameters=[OpenApiParameter(name="key", type=str, required=True, location=OpenApiParameter.QUERY)],
        responses={200: FeatureFlagSerializer, 404: FlagNotFoundSerializer},
    )
    @action(detail=False, methods=["get"], url_path="by_key")
    def by_key(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        key = request.query_params.get("key")
        if key is None or key == "":
            return Response({"key": ["This query parameter is required."]}, status=status.HTTP_400_BAD_REQUEST)
        flag = self.get_queryset().filter(key=key).first()
        if flag is None:
            return _controlled_not_found(code="flag_not_found", detail="Feature flag not found.")
        return Response(FeatureFlagSerializer(flag).data)

    def _set_active(self, *, active: bool) -> Response:
        with transaction.atomic():
            flag = get_object_or_404(
                FeatureFlag.objects.select_for_update(),
                pk=self.kwargs["pk"],
                team_id=self.kwargs["team_id"],
                deleted=False,
            )
            if flag.active != active:
                flag.active = active
                flag.save(update_fields={"active"})
        return Response(FeatureFlagSerializer(flag).data)

    @extend_schema(request=None, responses=FeatureFlagSerializer)
    @action(detail=True, methods=["post"])
    def enable(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return self._set_active(active=True)

    @extend_schema(request=None, responses=FeatureFlagSerializer)
    @action(detail=True, methods=["post"])
    def disable(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return self._set_active(active=False)

    @extend_schema(request=SetRolloutPercentageSerializer, responses=FeatureFlagSerializer)
    @action(detail=True, methods=["post"], url_path="set_rollout_percentage")
    def set_rollout_percentage(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        request_serializer = SetRolloutPercentageSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        input_data = request_serializer.validated_data
        with transaction.atomic():
            flag = get_object_or_404(
                FeatureFlag.objects.select_for_update(),
                pk=self.kwargs["pk"],
                team_id=self.kwargs["team_id"],
                deleted=False,
            )
            if flag.version != input_data["expected_version"]:
                raise VersionConflict(flag.version)
            if RolloutPlan.objects.filter(flag=flag).exists():
                raise ManagedGroupConflict()
            filters = deepcopy(flag.filters)
            groups = filters.get("groups") if isinstance(filters, dict) else None
            index = cast(int, input_data["condition_index"])
            if not isinstance(groups, list) or index >= len(groups) or not isinstance(groups[index], dict):
                return Response(
                    {"condition_index": ["Must identify an existing release condition."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            groups[index]["rollout_percentage"] = input_data["rollout_percentage"]
            flag.filters = filters
            flag.save(update_fields={"filters"})
        return Response(FeatureFlagSerializer(flag).data)

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

    @extend_schema(responses={200: RolloutPlanSerializer, 404: RolloutPlanNotFoundSerializer})
    @action(detail=True, methods=["get"], url_path="rollout_plan")
    def rollout_plan(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        flag = self.get_object()
        plan = RolloutPlan.objects.filter(flag=flag).first()
        if plan is None:
            return _controlled_not_found(code="rollout_plan_not_found", detail="Rollout plan not found.")
        return Response(RolloutPlanSerializer(plan).data)

    @extend_schema(
        request=RolloutPlanMutationSerializer,
        responses={200: RolloutPlanSerializer, 201: RolloutPlanSerializer},
    )
    @rollout_plan.mapping.put
    def update_rollout_plan(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        with transaction.atomic():
            locked_flag = get_object_or_404(
                FeatureFlag.objects.select_for_update(),
                pk=self.kwargs["pk"],
                team_id=self.kwargs["team_id"],
                deleted=False,
            )
            plan = RolloutPlan.objects.select_for_update().filter(flag=locked_flag).first()
            concurrency_data = {
                field: request.data[field]
                for field in ("expected_plan_id", "expected_version")
                if field in request.data
            }
            concurrency_serializer = PlanMutationConcurrencySerializer(data=concurrency_data)
            concurrency_serializer.is_valid(raise_exception=True)
            expected_plan_id = concurrency_serializer.validated_data["expected_plan_id"]
            expected_version = concurrency_serializer.validated_data["expected_version"]
            expected_absent = expected_plan_id is None and expected_version is None
            expected_existing = expected_plan_id is not None and expected_version is not None
            if (
                (not expected_absent and not expected_existing)
                or (expected_absent and plan is not None)
                or (
                    expected_existing
                    and (plan is None or plan.pk != expected_plan_id or plan.version != expected_version)
                )
            ):
                raise PlanConcurrencyConflict(plan)

            serializer = RolloutPlanMutationSerializer(
                plan,
                data=request.data,
                context={**self.get_serializer_context(), "flag": locked_flag},
            )
            serializer.is_valid(raise_exception=True)
            input_data = dict(serializer.validated_data)
            input_data.pop("expected_plan_id")
            input_data.pop("expected_version")

            created = plan is None
            if plan is None:
                plan = RolloutPlan(flag=locked_flag, **input_data)
            else:
                for field, value in input_data.items():
                    setattr(plan, field, value)
            try:
                if plan.status == RolloutPlan.Status.ACTIVE:
                    phase = cast(list[dict[str, Any]], plan.phases)[plan.current_phase_index]
                    set_managed_rollout_percentage(locked_flag, plan, float(phase["percentage"]))
                    plan.phase_entered_at = timezone.now()
                    plan.hold_reason = ""
                    plan.hold_started_at = None
                elif plan.status == RolloutPlan.Status.REVERTED:
                    set_managed_rollout_percentage(locked_flag, plan, 0)
                    plan.hold_reason = "manual_revert"
                    plan.hold_started_at = None
            except InvalidManagedGroupError as error:
                raise ManagedGroupConflict(str(error)) from error
            plan.save()

        response_serializer = RolloutPlanSerializer(plan)
        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(response_serializer.data, status=response_status)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="expected_plan_id",
                type=int,
                required=True,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="expected_version",
                type=int,
                required=True,
                location=OpenApiParameter.QUERY,
            ),
        ],
        responses={204: OpenApiResponse(description="Rollout plan deleted.")},
    )
    @rollout_plan.mapping.delete
    def delete_rollout_plan(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        request_serializer = PlanConcurrencySerializer(data=request.query_params)
        request_serializer.is_valid(raise_exception=True)
        expected = request_serializer.validated_data
        with transaction.atomic():
            flag = get_object_or_404(
                FeatureFlag.objects.select_for_update(),
                pk=self.kwargs["pk"],
                team_id=self.kwargs["team_id"],
                deleted=False,
            )
            plan = RolloutPlan.objects.select_for_update().filter(flag=flag).first()
            if plan is None:
                return _controlled_not_found(code="rollout_plan_not_found", detail="Rollout plan not found.")
            if plan.pk != expected["expected_plan_id"] or plan.version != expected["expected_version"]:
                raise PlanConcurrencyConflict(plan)
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
