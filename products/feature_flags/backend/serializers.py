import math
from collections.abc import Mapping
from decimal import Decimal
from typing import Any, cast

from rest_framework import serializers

from ensaio_kernel import EvaluationReason, PropertyOperator
from products.feature_flags.backend.models import FeatureFlag, Team

SUPPORTED_OPERATORS: tuple[PropertyOperator, ...] = (
    "exact",
    "is_not",
    "icontains",
    "not_icontains",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "not_in",
    "is_set",
    "is_not_set",
)
EVALUATION_REASONS: tuple[EvaluationReason, ...] = (
    "condition_match",
    "no_condition_match",
    "out_of_rollout_bound",
    "flag_disabled",
)
TRACE_STEPS = (
    "flag_active",
    "property",
    "condition",
    "rollout_hash",
    "variant_override",
    "variant_hash",
)


class StrictSerializer(serializers.Serializer[Any]):
    """Reject misspelled configuration instead of silently dropping it."""

    def to_internal_value(self, data: Any) -> dict[str, Any]:
        if isinstance(data, Mapping):
            unknown_fields = set(data) - set(self.fields)
            if unknown_fields:
                raise serializers.ValidationError({field: ["Unknown field."] for field in sorted(unknown_fields)})
        return cast(dict[str, Any], super().to_internal_value(data))


class PercentageField(serializers.FloatField):
    def to_internal_value(self, data: Any) -> float:
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            raise serializers.ValidationError("Must be a finite number.")
        return value


class PropertyFilterSerializer(StrictSerializer):
    key = serializers.CharField(allow_blank=False, max_length=400)
    type = serializers.ChoiceField(choices=("person",), default="person")
    operator = serializers.ChoiceField(choices=SUPPORTED_OPERATORS, default="exact")
    value = serializers.JSONField(required=False, allow_null=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        operator = attrs["operator"]
        if operator not in {"is_set", "is_not_set"} and "value" not in attrs:
            raise serializers.ValidationError({"value": "This field is required for this operator."})
        if operator in {"in", "not_in"} and not isinstance(attrs.get("value"), list):
            raise serializers.ValidationError({"value": "This operator requires a list."})
        return attrs


class ConditionSerializer(StrictSerializer):
    properties = PropertyFilterSerializer(many=True)
    rollout_percentage = PercentageField(min_value=0, max_value=100, default=100)
    variant = serializers.CharField(required=False, allow_null=True, allow_blank=False, default=None)


class VariantSerializer(StrictSerializer):
    key = serializers.CharField(allow_blank=False, max_length=400)
    rollout_percentage = PercentageField(min_value=0, max_value=100)


class MultivariateSerializer(StrictSerializer):
    variants = VariantSerializer(many=True, allow_empty=False)

    def validate_variants(self, variants: list[dict[str, Any]]) -> list[dict[str, Any]]:
        keys = [str(variant["key"]) for variant in variants]
        if len(keys) != len(set(keys)):
            raise serializers.ValidationError("Variant keys must be unique.")

        total = sum(Decimal(str(variant["rollout_percentage"])) for variant in variants)
        if total != Decimal(100):
            raise serializers.ValidationError("Variant rollout percentages must sum to exactly 100.")
        return variants


class FiltersSerializer(StrictSerializer):
    groups = ConditionSerializer(many=True)
    multivariate = MultivariateSerializer(required=False, allow_null=True)
    payloads = serializers.DictField(child=serializers.JSONField(allow_null=True), required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        multivariate = attrs.get("multivariate")
        variant_keys = (
            {str(variant["key"]) for variant in multivariate["variants"]} if isinstance(multivariate, dict) else set()
        )

        payloads = attrs.get("payloads", {})
        unknown_payload_keys = set(payloads) - variant_keys
        if unknown_payload_keys:
            raise serializers.ValidationError(
                {"payloads": f"Payload keys must name variants: {', '.join(sorted(unknown_payload_keys))}."}
            )

        for index, group in enumerate(attrs["groups"]):
            override = group.get("variant")
            if override is not None and override not in variant_keys:
                raise serializers.ValidationError(
                    {"groups": {str(index): {"variant": "Variant override must name a configured variant."}}}
                )
        return attrs


class FeatureFlagSerializer(serializers.ModelSerializer[FeatureFlag]):
    team_id = serializers.IntegerField(read_only=True)
    created_by_id = serializers.IntegerField(read_only=True, allow_null=True)
    filters = FiltersSerializer(required=False)

    class Meta:
        model = FeatureFlag
        fields = (
            "id",
            "team_id",
            "key",
            "name",
            "active",
            "deleted",
            "version",
            "filters",
            "created_by_id",
            "created_at",
        )
        read_only_fields = ("id", "team_id", "deleted", "version", "created_by_id", "created_at")
        validators: list[object] = []

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        team = self.context.get("team")
        if not isinstance(team, Team):
            return attrs

        instance = self.instance if isinstance(self.instance, FeatureFlag) else None
        key = attrs.get("key", instance.key if instance is not None else None)
        if key is None:
            return attrs

        matching_flags = FeatureFlag.objects.filter(team=team, key=key, deleted=False)
        if instance is not None:
            matching_flags = matching_flags.exclude(pk=instance.pk)
        if matching_flags.exists():
            raise serializers.ValidationError({"key": "A live flag with this key already exists in this team."})
        return attrs


class TraceRequestSerializer(StrictSerializer):
    distinct_id = serializers.CharField(allow_blank=True, max_length=400)
    properties = serializers.DictField(
        child=serializers.JSONField(allow_null=True),
        required=False,
        default=dict,
    )


class TraceStepSerializer(serializers.Serializer[Any]):
    step = serializers.ChoiceField(choices=TRACE_STEPS)
    result = serializers.BooleanField(required=False)
    condition_index = serializers.IntegerField(required=False)
    property_index = serializers.IntegerField(required=False)
    key = serializers.CharField(required=False)
    operator = serializers.ChoiceField(choices=SUPPORTED_OPERATORS, required=False)
    actual = serializers.JSONField(required=False, allow_null=True)
    expected = serializers.JSONField(required=False, allow_null=True)
    missing = serializers.BooleanField(required=False)
    index = serializers.IntegerField(required=False)
    filters_pass = serializers.BooleanField(required=False)
    hash_key = serializers.CharField(required=False, allow_null=True)
    value = serializers.FloatField(required=False, allow_null=True)
    threshold = serializers.FloatField(required=False)
    in_rollout = serializers.BooleanField(required=False)
    variant = serializers.CharField(required=False, allow_null=True)


class EvaluationResultSerializer(serializers.Serializer[Any]):
    enabled = serializers.BooleanField()
    variant = serializers.CharField(allow_null=True)
    payload = serializers.JSONField(allow_null=True)
    reason = serializers.ChoiceField(choices=EVALUATION_REASONS)
    condition_index = serializers.IntegerField(allow_null=True)
    trace = TraceStepSerializer(many=True)
