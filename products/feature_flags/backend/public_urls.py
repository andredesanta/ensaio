from django.urls import path

from products.feature_flags.backend.public_views import FlagDefinitionsView, FlagsView

app_name = "feature_flags_public"

urlpatterns = [
    path("flags/", FlagsView.as_view(), name="flags"),
    path("flags/definitions", FlagDefinitionsView.as_view(), name="flag-definitions"),
]
