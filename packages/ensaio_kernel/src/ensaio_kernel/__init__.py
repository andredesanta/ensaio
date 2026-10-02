"""Pure, deterministic feature-flag evaluation with PostHog-compatible bucketing."""

from ensaio_kernel.evaluate import evaluate
from ensaio_kernel.hashing import LONG_SCALE, calculate_hash, hash_position, is_in_rollout, select_variant
from ensaio_kernel.types import (
    ConditionTrace,
    EvaluationReason,
    EvaluationResult,
    FlagActiveTrace,
    FlagDefinition,
    JSONScalar,
    JSONValue,
    PropertyOperator,
    PropertyTrace,
    RolloutTrace,
    TraceStep,
    Variant,
    VariantHashTrace,
    VariantOverrideTrace,
)

__all__ = [
    "LONG_SCALE",
    "ConditionTrace",
    "EvaluationReason",
    "EvaluationResult",
    "FlagActiveTrace",
    "FlagDefinition",
    "JSONScalar",
    "JSONValue",
    "PropertyOperator",
    "PropertyTrace",
    "RolloutTrace",
    "TraceStep",
    "Variant",
    "VariantHashTrace",
    "VariantOverrideTrace",
    "calculate_hash",
    "evaluate",
    "hash_position",
    "is_in_rollout",
    "select_variant",
]
