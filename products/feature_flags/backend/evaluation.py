from collections.abc import Mapping

from ensaio_kernel import EvaluationResult, FlagDefinition, evaluate
from products.feature_flags.backend.models import FeatureFlag


def evaluate_feature_flag(
    flag: FeatureFlag,
    *,
    distinct_id: str,
    properties: Mapping[str, object],
) -> EvaluationResult:
    """Copy ORM state into the pure kernel's immutable boundary type."""

    definition = FlagDefinition(
        key=flag.key,
        active=flag.active,
        filters=flag.filters,
        version=flag.version,
    )
    return evaluate(definition, distinct_id, properties)
