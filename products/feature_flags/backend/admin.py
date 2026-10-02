from django.contrib import admin

from products.feature_flags.backend.models import FeatureFlag, Team


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "name", "created_at")
    search_fields = ("name",)
    readonly_fields = ("api_token", "secret_api_token", "created_at")


@admin.register(FeatureFlag)
class FeatureFlagAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "key", "team", "active", "deleted", "version", "created_at")
    list_filter = ("active", "deleted", "team")
    search_fields = ("key", "name")
    readonly_fields = ("version", "created_by", "created_at")
