from drf_spectacular.views import SpectacularAPIView
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import AllowAny


class SchemaView(SpectacularAPIView):
    """OpenAPI document the console's types will be generated from (via orval).

    Public on purpose: it describes API shapes but serves no flag data. The
    management API operations it documents remain session-authenticated.
    """

    authentication_classes: list[type[BaseAuthentication]] = []
    permission_classes = [AllowAny]
