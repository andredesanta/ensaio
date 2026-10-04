import secrets
from collections.abc import Iterable

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q
from django.db.models.base import ModelBase
from django.utils import timezone

from products.feature_flags.backend.definitions_cache import schedule_definitions_cache_invalidation

PUBLIC_TOKEN_PREFIX = "ens_pub_"
SECRET_TOKEN_PREFIX = "ens_sec_"
AUTOMATION_TOKEN_PREFIX = "ens_pat_"
AUTOMATION_TOKEN_SCOPES = ("feature_flag:read", "feature_flag:write")


def generate_public_api_token() -> str:
    """Generate the lookup token clients will eventually send to ``POST /flags``."""

    return f"{PUBLIC_TOKEN_PREFIX}{secrets.token_urlsafe(24)}"


def generate_secret_api_token() -> str:
    """Generate a definitions token; callers must persist only its hash."""

    return f"{SECRET_TOKEN_PREFIX}{secrets.token_urlsafe(24)}"


def unusable_secret_api_token() -> str:
    """Prevent definitions access until an operator explicitly issues a token."""

    return make_password(None)


def default_filters() -> dict[str, object]:
    """Return a fresh definition with no matching release conditions."""

    return {"groups": []}


def validate_automation_scopes(value: object) -> None:
    if not isinstance(value, list) or not value:
        raise ValidationError("Scopes must be a non-empty list.")
    if any(not isinstance(scope, str) or scope not in AUTOMATION_TOKEN_SCOPES for scope in value):
        raise ValidationError(f"Scopes may contain only: {', '.join(AUTOMATION_TOKEN_SCOPES)}.")
    if len(value) != len(set(value)):
        raise ValidationError("Scopes must not contain duplicates.")


class Team(models.Model):
    name = models.CharField(max_length=200)
    api_token = models.CharField(max_length=64, unique=True, default=generate_public_api_token, editable=False)
    secret_api_token = models.CharField(max_length=128, default=unusable_secret_api_token, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name

    def issue_secret_api_token(self) -> str:
        """Return a new raw token once while retaining only its password hash."""

        token = generate_secret_api_token()
        self.secret_api_token = make_password(token)
        return token

    def check_secret_api_token(self, token: str) -> bool:
        return token.startswith(SECRET_TOKEN_PREFIX) and check_password(token, self.secret_api_token)


class AutomationToken(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="automation_tokens")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="automation_tokens")
    name = models.CharField(max_length=200)
    selector = models.CharField(max_length=22, unique=True, editable=False)
    secret_hash = models.CharField(max_length=128, editable=False)
    scopes = models.JSONField(validators=[validate_automation_scopes])
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.name} ({self.selector})"

    @classmethod
    def issue(cls, *, team: Team, user: User, name: str, scopes: list[str]) -> tuple["AutomationToken", str]:
        selector = secrets.token_urlsafe(16)
        secret = secrets.token_urlsafe(32)
        raw_token = f"{AUTOMATION_TOKEN_PREFIX}{selector}.{secret}"
        token = cls(
            team=team,
            user=user,
            name=name,
            selector=selector,
            secret_hash=make_password(secret),
            scopes=scopes,
        )
        token.full_clean()
        token.save(force_insert=True)
        return token, raw_token

    def check_secret(self, secret: str) -> bool:
        return check_password(secret, self.secret_hash)

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None


class FeatureFlag(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="feature_flags")
    key = models.SlugField(max_length=400)
    name = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    deleted = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1, editable=False)
    filters = models.JSONField(default=default_filters)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="created_feature_flags",
        null=True,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["team", "key"],
                condition=Q(deleted=False),
                name="feature_flags_unique_live_key_per_team",
            )
        ]
        indexes = [
            models.Index(fields=["team", "deleted"], name="feature_flags_team_deleted_idx"),
        ]
        ordering = ["id"]

    def __str__(self) -> str:
        return self.key

    def save(
        self,
        *,
        force_insert: bool | tuple[ModelBase, ...] = False,
        force_update: bool = False,
        using: str | None = None,
        update_fields: Iterable[str] | None = None,
    ) -> None:
        """Atomically advance the definition version on every update."""

        is_update = not self._state.adding
        if is_update:
            self.version = F("version") + 1
            if update_fields is not None:
                update_fields = {*update_fields, "version"}

        super().save(
            force_insert=force_insert,
            force_update=force_update,
            using=using,
            update_fields=update_fields,
        )

        if is_update:
            self.refresh_from_db(fields=["version"], using=using)

        schedule_definitions_cache_invalidation(self.team_id)


class RolloutPlan(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        HOLDING = "HOLDING", "Holding"
        PAUSED = "PAUSED", "Paused"
        COMPLETED = "COMPLETED", "Completed"
        REVERTED = "REVERTED", "Reverted"

    flag = models.OneToOneField(FeatureFlag, on_delete=models.CASCADE, related_name="rollout_plan")
    status = models.CharField(max_length=16, choices=Status, default=Status.DRAFT)
    managed_group_index = models.PositiveIntegerField()
    phases = models.JSONField()
    current_phase_index = models.PositiveIntegerField(default=0)
    phase_entered_at = models.DateTimeField(default=timezone.now)
    hold_reason = models.CharField(max_length=100, blank=True)
    hold_started_at = models.DateTimeField(null=True, blank=True)
    guardrail = models.JSONField()
    version = models.PositiveIntegerField(default=1, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.flag.key}: {self.status}"

    def save(
        self,
        *,
        force_insert: bool | tuple[ModelBase, ...] = False,
        force_update: bool = False,
        using: str | None = None,
        update_fields: Iterable[str] | None = None,
    ) -> None:
        is_update = not self._state.adding
        if is_update:
            self.version = F("version") + 1
            if update_fields is not None:
                update_fields = {*update_fields, "version"}
        super().save(
            force_insert=force_insert,
            force_update=force_update,
            using=using,
            update_fields=update_fields,
        )
        if is_update:
            self.refresh_from_db(fields=["version"], using=using)


class GuardrailSample(models.Model):
    plan = models.ForeignKey(RolloutPlan, on_delete=models.CASCADE, related_name="samples")
    recorded_at = models.DateTimeField(default=timezone.now)
    value = models.FloatField()
    sample_count = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at", "-id"]

    def __str__(self) -> str:
        return f"{self.plan_id}: {self.value} ({self.sample_count})"
