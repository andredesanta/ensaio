from drf_spectacular.views import SpectacularAPIView
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import AllowAny


class SchemaView(SpectacularAPIView):
    """OpenAPI document the console's types will be generated from (M3, via orval).

    Public on purpose while the document lists no resources. The management API
    itself stays authenticated: this view does not serve flag data.
    """

    authentication_classes: list[type[BaseAuthentication]] = []
    permission_classes = [AllowAny]
