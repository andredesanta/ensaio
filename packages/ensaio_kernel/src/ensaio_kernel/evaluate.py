import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from ensaio_kernel.hashing import hash_position, is_in_rollout, select_variant
from ensaio_kernel.types import (
    ConditionTrace,
    EvaluationReason,
    EvaluationResult,
    FlagActiveTrace,
    FlagDefinition,
    PropertyOperator,
    PropertyTrace,
    RolloutTrace,
    TraceStep,
    Variant,
    VariantHashTrace,
    VariantOverrideTrace,
)

_MISSING = object()
_SUPPORTED_OPERATORS = frozenset(
    {
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
    }
)


@dataclass(frozen=True, kw_only=True, slots=True)
class _PropertyMatch:
    key: str
    operator: PropertyOperator
    actual: object | None
    expected: object | None
    missing: bool
    result: bool


def _as_mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise TypeError("validated flag value must be an object")
    return cast(Mapping[str, object], value)


def _as_sequence(value: object) -> Sequence[object]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise TypeError("validated flag value must be a list")
    return cast(Sequence[object], value)


def _as_float(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("validated percentage must be numeric")
    return float(value)


def _json_text(value: object) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _equals(configured: object, actual: object) -> bool:
    return _json_text(configured).lower() == _json_text(actual).lower()


def _exact_match(configured: object, actual: object) -> bool:
    if isinstance(configured, list):
        return any(_equals(candidate, actual) for candidate in configured)
    return _equals(configured, actual)


def _as_finite_number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
    elif isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return parsed if math.isfinite(parsed) else None


def _operator(value: object) -> PropertyOperator:
    if not isinstance(value, str) or value not in _SUPPORTED_OPERATORS:
        raise TypeError("validated property filter has an unsupported operator")
    return cast(PropertyOperator, value)


def _match_property(property_filter: Mapping[str, object], properties: Mapping[str, object]) -> _PropertyMatch:
    key_value = property_filter.get("key")
    if not isinstance(key_value, str):
        raise TypeError("validated property filter key must be a string")
    key = key_value
    operator = _operator(property_filter.get("operator", "exact"))
    expected = property_filter.get("value")
    actual_or_missing = properties.get(key, _MISSING)
    missing = actual_or_missing is _MISSING
    actual = None if missing else actual_or_missing

    if operator == "is_set":
        result = not missing
    elif operator == "is_not_set":
        result = missing
    elif missing:
        # Ensaio deliberately fails closed for every value-requiring operator.
        # This differs from PostHog's legacy negative-operator behavior and is
        # pinned by golden vectors.
        result = False
    elif operator == "exact":
        result = _exact_match(expected, actual)
    elif operator == "is_not":
        result = not _exact_match(expected, actual)
    elif operator in {"icontains", "not_icontains"}:
        contained = _json_text(expected).lower() in _json_text(actual).lower()
        result = contained if operator == "icontains" else not contained
    elif operator in {"gt", "gte", "lt", "lte"}:
        actual_number = _as_finite_number(actual)
        expected_number = _as_finite_number(expected)
        if actual_number is None or expected_number is None:
            result = False
        elif operator == "gt":
            result = actual_number > expected_number
        elif operator == "gte":
            result = actual_number >= expected_number
        elif operator == "lt":
            result = actual_number < expected_number
        else:
            result = actual_number <= expected_number
    else:
        candidates = _as_sequence(expected)
        included = any(_equals(candidate, actual) for candidate in candidates)
        result = included if operator == "in" else not included

    return _PropertyMatch(
        key=key,
        operator=operator,
        actual=actual,
        expected=expected,
        missing=missing,
        result=result,
    )


def _variants(filters: Mapping[str, object]) -> tuple[Variant, ...]:
    multivariate_value = filters.get("multivariate")
    if multivariate_value is None:
        return ()
    multivariate = _as_mapping(multivariate_value)
    variants_value = multivariate.get("variants", [])
    variants: list[Variant] = []
    for raw_variant in _as_sequence(variants_value):
        variant = _as_mapping(raw_variant)
        key = variant.get("key")
        if not isinstance(key, str):
            raise TypeError("validated variant key must be a string")
        variants.append(
            Variant(
                key=key,
                rollout_percentage=_as_float(variant.get("rollout_percentage")),
            )
        )
    return tuple(variants)


def _payload(filters: Mapping[str, object], variant: str | None) -> object | None:
    if variant is None:
        return None
    payloads_value = filters.get("payloads")
    if payloads_value is None:
        return None
    return _as_mapping(payloads_value).get(variant)


def _disabled_result(trace: list[TraceStep], reason: EvaluationReason) -> EvaluationResult:
    return EvaluationResult(
        enabled=False,
        variant=None,
        payload=None,
        reason=reason,
        condition_index=None,
        trace=tuple(trace),
    )


def evaluate(
    flag: FlagDefinition,
    distinct_id: str,
    properties: Mapping[str, object],
) -> EvaluationResult:
    """Evaluate one validated flag definition without I/O, time, or randomness."""

    trace: list[TraceStep] = [FlagActiveTrace(result=flag.active)]
    if not flag.active:
        return _disabled_result(trace, "flag_disabled")

    groups = _as_sequence(flag.filters.get("groups", []))
    best_reason: EvaluationReason = "no_condition_match"

    for condition_index, raw_group in enumerate(groups):
        group = _as_mapping(raw_group)
        property_filters = _as_sequence(group.get("properties", []))
        filters_pass = True

        for property_index, raw_property_filter in enumerate(property_filters):
            property_match = _match_property(_as_mapping(raw_property_filter), properties)
            trace.append(
                PropertyTrace(
                    condition_index=condition_index,
                    property_index=property_index,
                    key=property_match.key,
                    operator=property_match.operator,
                    actual=property_match.actual,
                    expected=property_match.expected,
                    missing=property_match.missing,
                    result=property_match.result,
                )
            )
            if not property_match.result:
                filters_pass = False
                break

        trace.append(ConditionTrace(index=condition_index, filters_pass=filters_pass))
        if not filters_pass:
            continue

        rollout_percentage = _as_float(group.get("rollout_percentage", 100))
        if rollout_percentage == 100:
            rollout_position = None
            rollout_key = None
        else:
            rollout_position = hash_position(flag.key, distinct_id)
            rollout_key = f"{flag.key}.{distinct_id}"
        in_rollout = is_in_rollout(rollout_percentage, rollout_position)
        trace.append(
            RolloutTrace(
                condition_index=condition_index,
                hash_key=rollout_key,
                value=rollout_position,
                threshold=rollout_percentage / 100,
                in_rollout=in_rollout,
            )
        )
        if not in_rollout:
            best_reason = "out_of_rollout_bound"
            continue

        variant: str | None
        override = group.get("variant")
        if override is not None:
            if not isinstance(override, str):
                raise TypeError("validated variant override must be a string or null")
            variant = override
            trace.append(VariantOverrideTrace(condition_index=condition_index, variant=variant))
        else:
            variants = _variants(flag.filters)
            if variants:
                variant_position = hash_position(flag.key, distinct_id, "variant")
                variant = select_variant(variant_position, variants)
                trace.append(
                    VariantHashTrace(
                        hash_key=f"{flag.key}.{distinct_id}variant",
                        value=variant_position,
                        variant=variant,
                    )
                )
            else:
                variant = None

        return EvaluationResult(
            enabled=True,
            variant=variant,
            payload=_payload(flag.filters, variant),
            reason="condition_match",
            condition_index=condition_index,
            trace=tuple(trace),
        )

    return _disabled_result(trace, best_reason)
