/**
 * Scene and URL table for the flags product.
 *
 * PostHog's `products/feature_flags/manifest.tsx` is the same idea: the product
 * declares its own routes instead of registering them inside the app shell.
 * Scene modules stay inside the product. The app shell only supplies routing
 * glue and a team ID.
 */
export const urls = {
    featureFlags: (): string => '/feature_flags',
    featureFlag: (id: string | number): string => `/feature_flags/${id}`,
    featureFlagNew: (): string => '/feature_flags/new',
    trace: (id: string | number): string => `/feature_flags/${id}/trace`,
}

export const scenes = {
    featureFlags: {
        path: urls.featureFlags(),
        load: () => import('./frontend/FeatureFlags'),
    },
    featureFlagNew: {
        path: urls.featureFlagNew(),
        load: () => import('./frontend/FeatureFlag'),
    },
    featureFlag: {
        path: '/feature_flags/:id',
        load: () => import('./frontend/FeatureFlag'),
    },
    trace: {
        path: '/feature_flags/:id/trace',
        load: () => import('./frontend/TraceView'),
    },
}
