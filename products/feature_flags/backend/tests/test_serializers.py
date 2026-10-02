import math

import pytest

from products.feature_flags.backend.serializers import FiltersSerializer


def _valid_filters() -> dict[str, object]:
    return {
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
        "payloads": {"test": {"layout": "v2"}},
    }


def test_design_document_filters_shape_is_valid() -> None:
    serializer = FiltersSerializer(data=_valid_filters())

    assert serializer.is_valid(), serializer.errors


@pytest.mark.parametrize("percentage", [-0.1, 100.1, math.inf, -math.inf, math.nan])
def test_rollout_percentage_must_be_finite_and_between_zero_and_one_hundred(percentage: float) -> None:
    filters = _valid_filters()
    groups = filters["groups"]
    assert isinstance(groups, list)
    groups[0]["rollout_percentage"] = percentage

    serializer = FiltersSerializer(data=filters)

    assert not serializer.is_valid()
    assert "groups" in serializer.errors


def test_unsupported_property_operator_is_rejected() -> None:
    filters = _valid_filters()
    groups = filters["groups"]
    assert isinstance(groups, list)
    groups[0]["properties"][0]["operator"] = "regex"

    serializer = FiltersSerializer(data=filters)

    assert not serializer.is_valid()
    assert "groups" in serializer.errors


def test_in_operator_requires_a_list() -> None:
    filters = _valid_filters()
    groups = filters["groups"]
    assert isinstance(groups, list)
    groups[0]["properties"][0]["operator"] = "in"
    groups[0]["properties"][0]["value"] = "pro"

    serializer = FiltersSerializer(data=filters)

    assert not serializer.is_valid()
    assert "groups" in serializer.errors


@pytest.mark.parametrize(
    "variants",
    [
        [
            {"key": "control", "rollout_percentage": 40},
            {"key": "test", "rollout_percentage": 40},
        ],
        [
            {"key": "control", "rollout_percentage": 50},
            {"key": "control", "rollout_percentage": 50},
        ],
    ],
)
def test_multivariate_weights_and_keys_are_validated(variants: list[dict[str, object]]) -> None:
    filters = _valid_filters()
    filters["multivariate"] = {"variants": variants}

    serializer = FiltersSerializer(data=filters)

    assert not serializer.is_valid()
    assert "multivariate" in serializer.errors


def test_payload_key_must_name_a_variant() -> None:
    filters = _valid_filters()
    filters["payloads"] = {"missing": {"layout": "v3"}}

    serializer = FiltersSerializer(data=filters)

    assert not serializer.is_valid()
    assert "payloads" in serializer.errors


def test_condition_override_must_name_a_variant() -> None:
    filters = _valid_filters()
    groups = filters["groups"]
    assert isinstance(groups, list)
    groups[0]["variant"] = "missing"

    serializer = FiltersSerializer(data=filters)

    assert not serializer.is_valid()
    assert "groups" in serializer.errors


def test_unknown_filter_key_is_rejected_instead_of_silently_dropped() -> None:
    filters = _valid_filters()
    filters["rollout_precentage"] = 50

    serializer = FiltersSerializer(data=filters)

    assert not serializer.is_valid()
    assert "rollout_precentage" in serializer.errors
