import { urls } from '../../products/feature_flags/manifest'

test('flag urls match the PostHog project path', (): void => {
    expect(urls.featureFlags()).toBe('/feature_flags')
    expect(urls.featureFlag(12)).toBe('/feature_flags/12')
    expect(urls.trace(12)).toBe('/feature_flags/12/trace')
})
