from typing import Any, cast

from django.test import Client


def test_openapi_exposes_public_management_and_trace_contracts_without_authentication(client: Client) -> None:
    response = client.get("/api/schema/?format=json")

    assert response.status_code == 200
    document = cast(dict[str, Any], response.json())
    paths = cast(dict[str, object], document["paths"])
    assert "/flags/" in paths
    assert "/flags/definitions" in paths
    assert "/api/projects/{team_id}/feature_flags/" in paths
    assert "/api/projects/{team_id}/feature_flags/{id}/trace/" in paths
