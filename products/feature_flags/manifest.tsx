/**
 * Scene and URL table for the flags product.
 *
 * PostHog's `products/feature_flags/manifest.tsx` is the same idea: the product
 * declares its own routes instead of registering them inside the app shell.
 * The scenes themselves are added in M3. The URL builders are here now so the
 * path shape (`/feature_flags/<id>`) is fixed before any component exists.
 */
export const urls = {
    featureFlags: (): string => '/feature_flags',
    featureFlag: (id: string | number): string => `/feature_flags/${id}`,
    featureFlagNew: (): string => '/feature_flags/new',
    trace: (id: string | number): string => `/feature_flags/${id}/trace`,
}
