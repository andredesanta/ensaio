import json
from pathlib import Path
from typing import TypedDict, cast

GOLDEN_VECTOR_DIRECTORY = Path(__file__).resolve().parents[1] / "golden_vectors"
GOLDEN_VECTOR_PATHS = tuple(sorted(GOLDEN_VECTOR_DIRECTORY.glob("*.json")))


class RawFlag(TypedDict):
    key: str
    active: bool
    version: int
    filters: dict[str, object]


class ExpectedResult(TypedDict):
    enabled: bool
    variant: str | None
    payload: object | None
    reason: str
    condition_index: int | None


class GoldenVector(TypedDict):
    name: str
    flag: RawFlag
    distinct_id: str
    properties: dict[str, object]
    expected: ExpectedResult


def load_vector(path: Path) -> GoldenVector:
    return cast(GoldenVector, json.loads(path.read_text()))
