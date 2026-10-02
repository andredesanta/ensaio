import json
from pathlib import Path
from typing import TypedDict, cast

import pytest

from ensaio_kernel import EvaluationReason, FlagDefinition, evaluate

GOLDEN_VECTOR_DIRECTORY = Path(__file__).resolve().parents[3] / "products/feature_flags/backend/golden_vectors"


class _RawFlag(TypedDict):
    key: str
    active: bool
    version: int
    filters: dict[str, object]


class _Expected(TypedDict):
    enabled: bool
    variant: str | None
    payload: object | None
    reason: EvaluationReason
    condition_index: int | None


class GoldenVector(TypedDict):
    name: str
    flag: _RawFlag
    distinct_id: str
    properties: dict[str, object]
    expected: _Expected


def _load_vector(path: Path) -> GoldenVector:
    return cast(GoldenVector, json.loads(path.read_text()))


GOLDEN_VECTOR_PATHS = tuple(sorted(GOLDEN_VECTOR_DIRECTORY.glob("*.json")))


@pytest.mark.parametrize("path", GOLDEN_VECTOR_PATHS, ids=lambda path: path.stem)
def test_kernel_matches_golden_vector(path: Path) -> None:
    vector = _load_vector(path)
    raw_flag = vector["flag"]
    expected = vector["expected"]

    result = evaluate(
        FlagDefinition(
            key=raw_flag["key"],
            active=raw_flag["active"],
            filters=raw_flag["filters"],
            version=raw_flag["version"],
        ),
        distinct_id=vector["distinct_id"],
        properties=vector["properties"],
    )

    assert result.enabled is expected["enabled"]
    assert result.variant == expected["variant"]
    assert result.payload == expected["payload"]
    assert result.reason == expected["reason"]
    assert result.condition_index == expected["condition_index"]


def test_m1_keeps_the_promised_golden_vector_set() -> None:
    assert len(GOLDEN_VECTOR_PATHS) == 15
