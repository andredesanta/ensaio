from typing import Any


def require_concurrency_fields(
    result: dict[str, Any],
    generator: object,
    request: object,
    public: bool,
) -> dict[str, Any]:
    """Restore required optimistic tokens that OpenAPI PATCH normalization removes."""

    schemas = result.get("components", {}).get("schemas", {})
    if not isinstance(schemas, dict):
        return result
    for schema in schemas.values():
        if not isinstance(schema, dict):
            continue
        properties = schema.get("properties")
        if not isinstance(properties, dict):
            continue
        concurrency_fields = {name for name in properties if name.startswith("expected_")}
        if not concurrency_fields:
            continue
        required = set(schema.get("required", []))
        schema["required"] = sorted(required | concurrency_fields)
    return result
