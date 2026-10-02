from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

type JSONScalar = str | int | float | bool | None
type JSONValue = JSONScalar | list[JSONValue] | dict[str, JSONValue]

type EvaluationReason = Literal[
    "condition_match",
    "no_condition_match",
    "out_of_rollout_bound",
    "flag_disabled",
]
type PropertyOperator = Literal[
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
]


@dataclass(frozen=True, kw_only=True, slots=True)
class FlagDefinition:
    """Validated, immutable snapshot of a feature flag.

    The Django layer will construct this value from a model in M2. Keeping ORM
    objects out of the contract is what lets a consumer run this package without
    Django after fetching definitions.
    """

    key: str
    active: bool
    filters: Mapping[str, object]
    version: int


@dataclass(frozen=True, kw_only=True, slots=True)
class Variant:
    key: str
    rollout_percentage: float


@dataclass(frozen=True, kw_only=True, slots=True)
class FlagActiveTrace:
    step: Literal["flag_active"] = "flag_active"
    result: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class PropertyTrace:
    step: Literal["property"] = "property"
    condition_index: int
    property_index: int
    key: str
    operator: PropertyOperator
    actual: object | None
    expected: object | None
    missing: bool
    result: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class ConditionTrace:
    step: Literal["condition"] = "condition"
    index: int
    filters_pass: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class RolloutTrace:
    step: Literal["rollout_hash"] = "rollout_hash"
    condition_index: int
    hash_key: str | None
    value: float | None
    threshold: float
    in_rollout: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class VariantOverrideTrace:
    step: Literal["variant_override"] = "variant_override"
    condition_index: int
    variant: str


@dataclass(frozen=True, kw_only=True, slots=True)
class VariantHashTrace:
    step: Literal["variant_hash"] = "variant_hash"
    hash_key: str
    value: float
    variant: str | None


type TraceStep = (
    FlagActiveTrace | PropertyTrace | ConditionTrace | RolloutTrace | VariantOverrideTrace | VariantHashTrace
)


@dataclass(frozen=True, kw_only=True, slots=True)
class EvaluationResult:
    enabled: bool
    variant: str | None
    payload: object | None
    reason: EvaluationReason
    condition_index: int | None
    trace: tuple[TraceStep, ...]
