from dataclasses import asdict
from typing import Any, Protocol, cast

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils.functional import cached_property
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from products.feature_flags.backend.evaluation import evaluate_feature_flag
from products.feature_flags.backend.models import FeatureFlag, Team
from products.feature_flags.backend.serializers import (
    EvaluationResultSerializer,
    FeatureFlagSerializer,
    TraceRequestSerializer,
)


class _HasDRFRequest(Protocol):
    request: Request


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
    queryset = FeatureFlag.objects.select_related("created_by")
    serializer_class = FeatureFlagSerializer

    def perform_destroy(self, instance: FeatureFlag) -> None:
        instance.deleted = True
        instance.save(update_fields={"deleted"})

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
