from collections.abc import Mapping

import pytest

from ensaio_kernel import (
    ConditionTrace,
    FlagActiveTrace,
    FlagDefinition,
    PropertyOperator,
    PropertyTrace,
    RolloutTrace,
    VariantHashTrace,
    evaluate,
)


def _property_flag(operator: PropertyOperator, expected: object) -> FlagDefinition:
    filters: dict[str, object] = {
        "groups": [
            {
                "properties": [
                    {
                        "key": "subject_property",
                        "type": "person",
                        "operator": operator,
                        "value": expected,
                    }
                ],
                "rollout_percentage": 100,
                "variant": None,
            }
        ]
    }
    return FlagDefinition(key=f"operator-{operator}", active=True, filters=filters, version=1)


@pytest.mark.parametrize(
    ("operator", "configured", "actual", "property_is_present"),
    [
        ("exact", ["BR", "US"], "br", True),
        ("is_not", "free", "pro", True),
        ("icontains", "ACME", "person@acme.example", True),
        ("not_icontains", "internal", "public.example", True),
        ("gt", 30, "31", True),
        ("gte", 30, 30, True),
        ("lt", 30, "29", True),
        ("lte", 30, 30, True),
        ("in", ["pro", "enterprise"], "enterprise", True),
        ("not_in", ["free", "trial"], "pro", True),
        ("is_set", None, None, True),
        ("is_not_set", None, None, False),
    ],
)
def test_supported_property_operator_matches(
    operator: PropertyOperator,
    configured: object,
    actual: object,
    property_is_present: bool,
) -> None:
    properties = {"subject_property": actual} if property_is_present else {}

    result = evaluate(_property_flag(operator, configured), "operator-user", properties)

    assert result.enabled
    assert result.reason == "condition_match"


@pytest.mark.parametrize(
    "operator",
    [
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
    ],
)
def test_missing_property_fails_every_value_operator(operator: PropertyOperator) -> None:
    configured: object = ["expected"] if operator in {"exact", "in", "not_in"} else "expected"

    result = evaluate(_property_flag(operator, configured), "missing-user", {})

    assert not result.enabled
    assert result.reason == "no_condition_match"


def test_numeric_comparison_fails_closed_for_non_numeric_property() -> None:
    result = evaluate(
        _property_flag("gte", 18),
        "invalid-number",
        {"subject_property": "old enough"},
    )

    assert not result.enabled
    assert result.reason == "no_condition_match"


def test_exact_uses_posthog_style_string_coercion() -> None:
    result = evaluate(
        _property_flag("exact", "42"),
        "coerced-number",
        {"subject_property": 42},
    )

    assert result.enabled


def test_first_matching_condition_wins_even_when_a_later_condition_has_variant_override() -> None:
    filters: dict[str, object] = {
        "groups": [
            {
                "properties": [
                    {
                        "key": "email",
                        "type": "person",
                        "operator": "exact",
                        "value": "specific@example.com",
                    }
                ],
                "rollout_percentage": 100,
                "variant": None,
            },
            {
                "properties": [],
                "rollout_percentage": 100,
                "variant": "test",
            },
        ],
        "multivariate": {
            "variants": [
                {"key": "control", "rollout_percentage": 100},
                {"key": "test", "rollout_percentage": 0},
            ]
        },
    }
    flag = FlagDefinition(key="condition-order", active=True, filters=filters, version=1)

    result = evaluate(flag, "specific-user", {"email": "specific@example.com"})

    assert result.enabled
    assert result.variant == "control"
    assert result.condition_index == 0


def test_trace_explains_property_rollout_and_variant_decisions() -> None:
    filters: dict[str, object] = {
        "groups": [
            {
                "properties": [
                    {
                        "key": "country",
                        "type": "person",
                        "operator": "exact",
                        "value": ["BR"],
                    }
                ],
                "rollout_percentage": 75,
                "variant": None,
            }
        ],
        "multivariate": {
            "variants": [
                {"key": "control", "rollout_percentage": 50},
                {"key": "test", "rollout_percentage": 50},
            ]
        },
    }

    result = evaluate(
        FlagDefinition(key="new-checkout", active=True, filters=filters, version=3),
        "u_7",
        {"country": "BR"},
    )

    assert result.trace == (
        FlagActiveTrace(result=True),
        PropertyTrace(
            condition_index=0,
            property_index=0,
            key="country",
            operator="exact",
            actual="BR",
            expected=["BR"],
            missing=False,
            result=True,
        ),
        ConditionTrace(index=0, filters_pass=True),
        RolloutTrace(
            condition_index=0,
            hash_key="new-checkout.u_7",
            value=0.6953144789025082,
            threshold=0.75,
            in_rollout=True,
        ),
        VariantHashTrace(
            hash_key="new-checkout.u_7variant",
            value=0.8025934176866744,
            variant="test",
        ),
    )


def test_hundred_percent_rollout_trace_records_hash_bypass() -> None:
    filters: dict[str, object] = {"groups": [{"properties": [], "rollout_percentage": 100, "variant": None}]}

    result = evaluate(
        FlagDefinition(key="full-rollout", active=True, filters=filters, version=1),
        "anyone",
        {},
    )

    rollout_step = next(step for step in result.trace if isinstance(step, RolloutTrace))
    assert rollout_step.hash_key is None
    assert rollout_step.value is None
    assert rollout_step.in_rollout


def test_empty_identifier_matches_posthog_zero_percent_edge() -> None:
    filters: dict[str, object] = {"groups": [{"properties": [], "rollout_percentage": 0, "variant": None}]}

    result = evaluate(
        FlagDefinition(key="zero-rollout", active=True, filters=filters, version=1),
        "",
        {},
    )

    assert result.enabled
    assert result.reason == "condition_match"


def test_inactive_flag_stops_before_reading_malformed_filters() -> None:
    result = evaluate(
        FlagDefinition(key="inactive", active=False, filters={"groups": "not-a-list"}, version=1),
        "anyone",
        {},
    )

    assert result.reason == "flag_disabled"
    assert result.trace == (FlagActiveTrace(result=False),)


def _enabled_subjects(flag: FlagDefinition, subjects: list[str], properties: Mapping[str, object]) -> set[str]:
    return {subject for subject in subjects if evaluate(flag, subject, properties).enabled}


def test_raising_rollout_percentage_only_adds_subjects() -> None:
    subjects = [f"subject-{index}" for index in range(1_000)]

    def flag_at(percentage: float) -> FlagDefinition:
        filters: dict[str, object] = {"groups": [{"properties": [], "rollout_percentage": percentage, "variant": None}]}
        return FlagDefinition(key="monotone-ramp", active=True, filters=filters, version=1)

    at_twenty_five = _enabled_subjects(flag_at(25), subjects, {})
    at_fifty = _enabled_subjects(flag_at(50), subjects, {})
    at_seventy_five = _enabled_subjects(flag_at(75), subjects, {})

    assert at_twenty_five < at_fifty < at_seventy_five
