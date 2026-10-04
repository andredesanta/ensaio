from typing import Any, cast

from django.test import Client


def test_openapi_exposes_public_management_trace_and_rollout_contracts_without_authentication(client: Client) -> None:
    response = client.get("/api/schema/?format=json")

    assert response.status_code == 200
    document = cast(dict[str, Any], response.json())
    paths = cast(dict[str, object], document["paths"])
    assert "/flags/" in paths
    assert "/flags/definitions" in paths
    assert "/api/projects/{team_id}/feature_flags/" in paths
    assert "/api/projects/{team_id}/feature_flags/{id}/trace/" in paths
    assert "/api/projects/{team_id}/feature_flags/{id}/rollout_plan/" in paths
    assert "/api/projects/{team_id}/feature_flags/{id}/guardrail_samples/" in paths

    management = cast(dict[str, Any], paths["/api/projects/{team_id}/feature_flags/"])
    list_operation = cast(dict[str, Any], management["get"])
    assert list_operation["x-product"] == "feature_flags"
    assert list_operation["security"] == [{"cookieAuth": []}, {"automationBearer": []}]

    components = cast(dict[str, Any], document["components"])
    schemas = cast(dict[str, Any], components["schemas"])
    patched_update = cast(dict[str, Any], schemas["PatchedFeatureFlagUpdateRequest"])
    assert "expected_version" in cast(list[str], patched_update["required"])
    security_schemes = cast(dict[str, Any], components["securitySchemes"])
    assert security_schemes["automationBearer"]["scheme"] == "bearer"
    assert security_schemes["cookieAuth"]["name"] == "sessionid"
    assert cast(dict[str, Any], paths["/flags/"])["post"]["x-product"] == "feature_flags"
    assert cast(dict[str, Any], paths["/flags/definitions"])["get"]["x-product"] == "feature_flags"
