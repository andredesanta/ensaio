import type { EvaluationResult, FeatureFlag } from './generated/models'

export function featureFlagFixture(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
    return {
        id: 1,
        team_id: 1,
        key: 'checkout-redesign',
        name: 'Checkout redesign',
        active: true,
        deleted: false,
        version: 1,
        filters: {
            groups: [{ properties: [], rollout_percentage: 100, variant: null }],
            multivariate: {
                variants: [
                    { key: 'control', rollout_percentage: 50 },
                    { key: 'test', rollout_percentage: 50 },
                ],
            },
            payloads: {},
        },
        rollout_plan_status: null,
        created_by_id: 1,
        created_at: '2026-01-01T00:00:00Z',
        ...overrides,
    }
}

export function evaluationResultFixture(): EvaluationResult {
    return {
        enabled: true,
        variant: 'test',
        payload: null,
        reason: 'condition_match',
        condition_index: 0,
        trace: [{ step: 'flag_active', result: true }],
    }
}
