from django.contrib import admin

from products.feature_flags.backend.models import AutomationToken, FeatureFlag, GuardrailSample, RolloutPlan, Team


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "name", "created_at")
    search_fields = ("name",)
    readonly_fields = ("api_token", "secret_api_token", "created_at")


@admin.register(AutomationToken)
class AutomationTokenAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "name", "team", "user", "selector", "revoked_at", "created_at")
    list_filter = ("team", "revoked_at")
    search_fields = ("name", "selector", "user__username")
    readonly_fields = ("selector", "secret_hash", "created_at", "revoked_at")


@admin.register(FeatureFlag)
class FeatureFlagAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "key", "team", "active", "deleted", "version", "created_at")
    list_filter = ("active", "deleted", "team")
    search_fields = ("key", "name")
    readonly_fields = ("version", "created_by", "created_at")


@admin.register(RolloutPlan)
class RolloutPlanAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "flag", "status", "current_phase_index", "phase_entered_at")
    list_filter = ("status",)
    readonly_fields = ("current_phase_index", "phase_entered_at", "hold_reason", "hold_started_at", "created_at")


@admin.register(GuardrailSample)
class GuardrailSampleAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "plan", "recorded_at", "value", "sample_count")
    readonly_fields = ("created_at",)
