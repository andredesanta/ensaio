from typing import Any, cast

import structlog
from django.utils.http import parse_etags
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from products.feature_flags.backend.definitions import find_team_by_secret_token, get_definitions_snapshot
from products.feature_flags.backend.evaluation import evaluate_feature_flag
from products.feature_flags.backend.models import FeatureFlag, Team
from products.feature_flags.backend.serializers import (
    DefinitionsResponseSerializer,
    FlagsRequestSerializer,
    FlagsResponseSerializer,
)

logger = structlog.get_logger(__name__)


def _unauthorized_response(*, bearer: bool) -> Response:
    response = Response({"detail": "Invalid API token."}, status=status.HTTP_401_UNAUTHORIZED)
    if bearer:
        response["WWW-Authenticate"] = "Bearer"
    return response


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("Authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if separator == "" or scheme.lower() != "bearer" or token.strip() == "":
        return None
    return token.strip()


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    if if_none_match is None:
        return False
    candidates = parse_etags(if_none_match)
    return any(candidate == "*" or candidate.removeprefix("W/") == etag for candidate in candidates)


class FlagsView(APIView):
    authentication_classes: list[type[Any]] = []
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="v",
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description="Ensaio implements only PostHog's version 2 response shape.",
            )
        ],
        request=FlagsRequestSerializer,
        responses={
            200: FlagsResponseSerializer,
            400: OpenApiResponse(description="Invalid version or request body."),
            401: OpenApiResponse(description="Unknown public project token."),
        },
    )
    def post(self, request: Request) -> Response:
        if request.query_params.get("v") != "2":
            return Response(
                {"v": ["Only version 2 is supported."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request_serializer = FlagsRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        request_data = request_serializer.validated_data

        team = Team.objects.filter(api_token=cast(str, request_data["api_key"])).first()
        if team is None:
            return _unauthorized_response(bearer=False)

        distinct_id = cast(str, request_data["distinct_id"])
        properties = cast(dict[str, object], request_data["person_properties"])
        flags: dict[str, object] = {}
        errors_while_computing = False

        queryset = (
            FeatureFlag.objects.filter(team=team, active=True, deleted=False)
            .only("id", "key", "active", "filters", "version")
            .order_by("id")
        )
        for flag in queryset:
            try:
                result = evaluate_feature_flag(flag, distinct_id=distinct_id, properties=properties)
            except Exception as error:
                errors_while_computing = True
                logger.error(
                    "feature_flag_evaluation_failed",
                    team_id=team.pk,
                    flag_id=flag.pk,
                    error_type=type(error).__name__,
                )
                continue

            flags[flag.key] = {
                "key": flag.key,
                "enabled": result.enabled,
                "variant": result.variant,
                "reason": {
                    "code": result.reason,
                    "condition_index": result.condition_index,
                },
                "metadata": {
                    "id": flag.pk,
                    "version": flag.version,
                    "payload": result.payload,
                },
            }

        response_payload = {
            "flags": flags,
            "errorsWhileComputingFlags": errors_while_computing,
        }
        response_serializer = FlagsResponseSerializer(response_payload)
        return Response(response_serializer.data, status=status.HTTP_200_OK)


class FlagDefinitionsView(APIView):
    authentication_classes: list[type[Any]] = []
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="Authorization",
                type=str,
                location=OpenApiParameter.HEADER,
                required=True,
                description="Bearer token using the team's ens_sec_ definitions secret.",
            ),
            OpenApiParameter(
                name="If-None-Match",
                type=str,
                location=OpenApiParameter.HEADER,
                required=False,
            ),
        ],
        responses={
            200: DefinitionsResponseSerializer,
            304: OpenApiResponse(description="Definitions have not changed."),
            401: OpenApiResponse(description="Missing or invalid definitions secret."),
        },
    )
    def get(self, request: Request) -> Response:
        token = _bearer_token(request)
        team = find_team_by_secret_token(token) if token is not None else None
        if team is None:
            return _unauthorized_response(bearer=True)

        snapshot = get_definitions_snapshot(team)
        if _etag_matches(request.headers.get("If-None-Match"), snapshot.etag):
            response = Response(status=status.HTTP_304_NOT_MODIFIED)
        else:
            response = Response(snapshot.payload, status=status.HTTP_200_OK)

        response["ETag"] = snapshot.etag
        response["Cache-Control"] = "private, must-revalidate"
        response["Vary"] = "Authorization"
        return response
