from rest_framework.routers import SimpleRouter

from products.feature_flags.backend.views import FeatureFlagViewSet

app_name = "feature_flags"

router = SimpleRouter()
router.register("feature_flags", FeatureFlagViewSet, basename="feature-flag")

urlpatterns = router.urls
