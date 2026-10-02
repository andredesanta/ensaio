from django.contrib import admin
from django.urls import include, path

from ensaio_project.health import healthz
from ensaio_project.schema import SchemaView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz, name="healthz"),
    path("api/schema/", SchemaView.as_view(), name="schema"),
    path("api/projects/<int:team_id>/", include("products.feature_flags.backend.urls")),
]
