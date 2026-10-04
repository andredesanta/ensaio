import re
from typing import Any

from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication, SessionAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed, NotFound
from rest_framework.permissions import BasePermission
from rest_framework.request import Request

from products.feature_flags.backend.models import AUTOMATION_TOKEN_PREFIX, AutomationToken

_TOKEN_PATTERN = re.compile(
    rf"{re.escape(AUTOMATION_TOKEN_PREFIX)}(?P<selector>[A-Za-z0-9_-]{{22}})\.(?P<secret>[A-Za-z0-9_-]{{43}})"
)
_MAX_AUTHORIZATION_LENGTH = 128

READ_ACTIONS = {"list", "retrieve", "by_key", "trace", "rollout_plan"}
WRITE_ACTIONS = {
    "create",
    "update",
    "partial_update",
    "destroy",
    "enable",
    "disable",
    "set_rollout_percentage",
    "update_rollout_plan",
    "delete_rollout_plan",
    "guardrail_samples",
}


class SessionOrAutomationAuthentication(BaseAuthentication):
    """Use a strict automation Bearer credential or preserve session/CSRF behavior."""

    def authenticate(self, request: Request) -> tuple[Any, AutomationToken] | tuple[Any, None] | None:
        raw_header = get_authorization_header(request)
        if not raw_header:
            return SessionAuthentication().authenticate(request)
        if len(raw_header) > _MAX_AUTHORIZATION_LENGTH:
            raise AuthenticationFailed("Invalid automation token.")

        try:
            header = raw_header.decode("ascii")
        except UnicodeDecodeError as error:
            raise AuthenticationFailed("Invalid automation token.") from error

        parts = header.split(" ")
        if len(parts) != 2 or parts[0] != "Bearer":
            raise AuthenticationFailed("Invalid automation token.")
        match = _TOKEN_PATTERN.fullmatch(parts[1])
        if match is None:
            raise AuthenticationFailed("Invalid automation token.")

        token = AutomationToken.objects.select_related("user", "team").filter(selector=match.group("selector")).first()
        if (
            token is None
            or token.revoked_at is not None
            or not token.user.is_active
            or not token.check_secret(match.group("secret"))
        ):
            raise AuthenticationFailed("Invalid automation token.")
        return token.user, token

    def authenticate_header(self, request: Request) -> str | None:
        return "Bearer" if get_authorization_header(request) else None


class AutomationScopePermission(BasePermission):
    """Apply action scopes to automation clients while retaining session access."""

    def has_permission(self, request: Request, view: Any) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if not isinstance(request.auth, AutomationToken):
            return True

        team_id = view.kwargs.get("team_id")
        if team_id is None or int(team_id) != request.auth.team_id:
            raise NotFound(
                detail={
                    "detail": "Project not found.",
                    "code": "project_not_found",
                }
            )

        action = getattr(view, "action", None)
        scopes = set(request.auth.scopes)
        if action in READ_ACTIONS:
            return bool(scopes & {"feature_flag:read", "feature_flag:write"})
        if action in WRITE_ACTIONS:
            return "feature_flag:write" in scopes
        return False


def revoke_automation_token(token: AutomationToken) -> None:
    if token.revoked_at is None:
        token.revoked_at = timezone.now()
        token.save(update_fields={"revoked_at"})


class AutomationBearerScheme(OpenApiAuthenticationExtension):  # type: ignore[no-untyped-call]
    target_class = SessionOrAutomationAuthentication
    name = "automationBearer"

    def get_security_definition(self, auto_schema: Any) -> dict[str, Any]:
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "ens_pat_<selector>.<secret>",
            "description": "Project-scoped Ensaio automation token.",
        }
