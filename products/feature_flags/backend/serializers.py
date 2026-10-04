import math
from collections.abc import Mapping
from decimal import Decimal
from typing import Any, cast

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from ensaio_kernel import EvaluationReason, PropertyOperator
from products.feature_flags.backend.models import FeatureFlag, GuardrailSample, RolloutPlan, Team

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
ROLLOUT_STATUSES = tuple(RolloutPlan.Status.values)


class FlagNotFoundSerializer(serializers.Serializer[Any]):
    detail = serializers.CharField()
    code = serializers.ChoiceField(choices=("flag_not_found",))


class RolloutPlanNotFoundSerializer(serializers.Serializer[Any]):
    detail = serializers.CharField()
    code = serializers.ChoiceField(choices=("rollout_plan_not_found",))


class StrictSerializer(serializers.Serializer[Any]):
    """Reject misspelled configuration instead of silently dropping it."""

    def to_internal_value(self, data: Any) -> dict[str, Any]:
        if isinstance(data, Mapping):
            unknown_fields = set(data) - set(self.fields)
            if unknown_fields:
                raise serializers.ValidationError({field: ["Unknown field."] for field in sorted(unknown_fields)})
        return cast(dict[str, Any], super().to_internal_value(data))


class FiniteFloatField(serializers.FloatField):
    def to_internal_value(self, data: Any) -> float:
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            raise serializers.ValidationError("Must be a finite number.")
        return value


class PercentageField(FiniteFloatField):
    pass


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
    rollout_plan_status = serializers.SerializerMethodField()

    class Meta:
        model = FeatureFlag
        fields: tuple[str, ...] = (
            "id",
            "team_id",
            "key",
            "name",
            "active",
            "deleted",
            "version",
            "filters",
            "rollout_plan_status",
            "created_by_id",
            "created_at",
        )
        read_only_fields = (
            "id",
            "team_id",
            "deleted",
            "version",
            "rollout_plan_status",
            "created_by_id",
            "created_at",
        )
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

    @extend_schema_field(serializers.ChoiceField(choices=ROLLOUT_STATUSES, allow_null=True))
    def get_rollout_plan_status(self, instance: FeatureFlag) -> str | None:
        try:
            return instance.rollout_plan.status
        except RolloutPlan.DoesNotExist:
            return None


class FeatureFlagUpdateSerializer(FeatureFlagSerializer):
    expected_version = serializers.IntegerField(min_value=1, write_only=True)

    class Meta(FeatureFlagSerializer.Meta):
        fields: tuple[str, ...] = (*FeatureFlagSerializer.Meta.fields, "expected_version")

    def update(self, instance: FeatureFlag, validated_data: dict[str, Any]) -> FeatureFlag:
        validated_data.pop("expected_version")
        return super().update(instance, validated_data)


class MetadataUpdateSerializer(StrictSerializer):
    key = serializers.CharField(required=False, allow_blank=False, max_length=400)
    name = serializers.CharField(required=False, allow_blank=True)
    expected_version = serializers.IntegerField(min_value=1)


class SetRolloutPercentageSerializer(StrictSerializer):
    condition_index = serializers.IntegerField(min_value=0)
    rollout_percentage = PercentageField(min_value=0, max_value=100)
    expected_version = serializers.IntegerField(min_value=1)


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


class FlagsRequestSerializer(StrictSerializer):
    api_key = serializers.CharField(allow_blank=False, max_length=64)
    distinct_id = serializers.CharField(allow_blank=True, max_length=400)
    person_properties = serializers.DictField(
        child=serializers.JSONField(allow_null=True),
        required=False,
        default=dict,
    )


class FlagEvaluationReasonSerializer(serializers.Serializer[Any]):
    code = serializers.ChoiceField(choices=EVALUATION_REASONS)
    condition_index = serializers.IntegerField(allow_null=True)


class FlagDetailsMetadataSerializer(serializers.Serializer[Any]):
    id = serializers.IntegerField()
    version = serializers.IntegerField()
    payload = serializers.JSONField(allow_null=True)


class FlagDetailsSerializer(serializers.Serializer[Any]):
    key = serializers.CharField()
    enabled = serializers.BooleanField()
    variant = serializers.CharField(allow_null=True)
    reason = FlagEvaluationReasonSerializer()
    metadata = FlagDetailsMetadataSerializer()


class FlagsResponseSerializer(serializers.Serializer[Any]):
    flags = serializers.DictField(child=FlagDetailsSerializer())
    errorsWhileComputingFlags = serializers.BooleanField()


class LocalEvaluationFlagSerializer(serializers.Serializer[Any]):
    key = serializers.CharField()
    active = serializers.BooleanField()
    filters = FiltersSerializer()
    version = serializers.IntegerField()


class DefinitionsResponseSerializer(serializers.Serializer[Any]):
    flags = LocalEvaluationFlagSerializer(many=True)


class RolloutPhaseSerializer(StrictSerializer):
    percentage = PercentageField(min_value=0, max_value=100)
    min_duration_minutes = serializers.IntegerField(min_value=0)


class GuardrailSerializer(StrictSerializer):
    name = serializers.CharField(allow_blank=False, max_length=100)
    comparison = serializers.ChoiceField(choices=("lt", "lte", "gt", "gte"))
    threshold = FiniteFloatField()
    window_minutes = serializers.IntegerField(min_value=1)
    min_samples = serializers.IntegerField(min_value=1)
    max_hold_minutes = serializers.IntegerField(min_value=1)


class GuardrailSampleSerializer(serializers.ModelSerializer[GuardrailSample]):
    plan_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = GuardrailSample
        fields = ("id", "plan_id", "recorded_at", "value", "sample_count", "created_at")
        read_only_fields = ("id", "plan_id", "recorded_at", "created_at")

    def validate_value(self, value: float) -> float:
        if not math.isfinite(value):
            raise serializers.ValidationError("Must be a finite number.")
        return value


class RolloutPlanSerializer(serializers.ModelSerializer[RolloutPlan]):
    flag_id = serializers.IntegerField(read_only=True)
    status = serializers.ChoiceField(choices=ROLLOUT_STATUSES, default=RolloutPlan.Status.DRAFT)
    phases = RolloutPhaseSerializer(many=True, allow_empty=False)
    guardrail = GuardrailSerializer()
    recent_samples = serializers.SerializerMethodField()

    class Meta:
        model = RolloutPlan
        fields: tuple[str, ...] = (
            "id",
            "flag_id",
            "status",
            "managed_group_index",
            "phases",
            "current_phase_index",
            "phase_entered_at",
            "hold_reason",
            "hold_started_at",
            "guardrail",
            "version",
            "recent_samples",
            "created_at",
        )
        read_only_fields = (
            "id",
            "flag_id",
            "current_phase_index",
            "phase_entered_at",
            "hold_reason",
            "hold_started_at",
            "version",
            "recent_samples",
            "created_at",
        )

    def validate_phases(self, phases: list[dict[str, Any]]) -> list[dict[str, Any]]:
        percentages = [float(phase["percentage"]) for phase in phases]
        if any(current >= following for current, following in zip(percentages, percentages[1:], strict=False)):
            raise serializers.ValidationError("Phase percentages must be strictly increasing.")
        return phases

    def validate_status(self, value: str) -> str:
        if value in {RolloutPlan.Status.HOLDING, RolloutPlan.Status.COMPLETED}:
            raise serializers.ValidationError("This status is controlled by tick_rollouts.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        flag = self.context.get("flag")
        if not isinstance(flag, FeatureFlag):
            return attrs

        instance = self.instance if isinstance(self.instance, RolloutPlan) else None
        managed_group_index = int(
            attrs.get(
                "managed_group_index",
                instance.managed_group_index if instance is not None else 0,
            )
        )
        groups = flag.filters.get("groups") if isinstance(flag.filters, dict) else None
        if not isinstance(groups, list) or managed_group_index >= len(groups):
            raise serializers.ValidationError(
                {"managed_group_index": "Must identify an existing entry in the flag's filters.groups."}
            )

        phases = attrs.get("phases", instance.phases if instance is not None else [])
        current_phase_index = instance.current_phase_index if instance is not None else 0
        if current_phase_index >= len(phases):
            raise serializers.ValidationError({"phases": "Must retain the rollout's current phase index."})
        return attrs

    @extend_schema_field(GuardrailSampleSerializer(many=True))
    def get_recent_samples(self, instance: RolloutPlan) -> list[dict[str, Any]]:
        samples = instance.samples.order_by("-recorded_at", "-id")[:5]
        return cast(list[dict[str, Any]], GuardrailSampleSerializer(samples, many=True).data)


class RolloutPlanMutationSerializer(RolloutPlanSerializer):
    expected_plan_id = serializers.IntegerField(min_value=1, allow_null=True)
    expected_version = serializers.IntegerField(min_value=1, allow_null=True)

    class Meta(RolloutPlanSerializer.Meta):
        fields: tuple[str, ...] = (*RolloutPlanSerializer.Meta.fields, "expected_plan_id", "expected_version")


class PlanMutationConcurrencySerializer(StrictSerializer):
    expected_plan_id = serializers.IntegerField(min_value=1, allow_null=True)
    expected_version = serializers.IntegerField(min_value=1, allow_null=True)


class PlanConcurrencySerializer(StrictSerializer):
    expected_plan_id = serializers.IntegerField(min_value=1)
    expected_version = serializers.IntegerField(min_value=1)
