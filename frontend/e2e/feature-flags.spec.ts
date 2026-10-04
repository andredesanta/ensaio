import { expect, test } from '@playwright/test'

import type {
    FeatureFlag,
    FeatureFlagRequest,
    RolloutPlanRequest,
} from '../../products/feature_flags/frontend/generated/models'

test('creates a flag, traces its decision, and reverts a health rollout', async ({ page }) => {
    let flags: FeatureFlag[] = []
    let submittedFlag: FeatureFlagRequest | null = null
    let submittedRolloutPlan: RolloutPlanRequest | null = null

    await page.route('**/api/projects/1/feature_flags/**', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const pathname = url.pathname

        if (pathname.endsWith('/rollout_plan/') && request.method() === 'GET') {
            if (submittedRolloutPlan !== null) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        id: 7,
                        flag_id: 101,
                        ...submittedRolloutPlan,
                        current_phase_index: 0,
                        phase_entered_at: '2026-10-02T12:00:00Z',
                        hold_reason: submittedRolloutPlan.status === 'REVERTED' ? 'manual_revert' : '',
                        hold_started_at: null,
                        recent_samples: [],
                        created_at: '2026-10-02T12:00:00Z',
                    }),
                })
                return
            }
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ detail: 'Not found.' }),
            })
            return
        }

        if (pathname.endsWith('/rollout_plan/') && request.method() === 'PUT') {
            const created = submittedRolloutPlan === null
            submittedRolloutPlan = request.postDataJSON() as RolloutPlanRequest
            flags = flags.map((flag) => ({ ...flag, rollout_plan_status: submittedRolloutPlan?.status ?? null }))
            await route.fulfill({
                status: created ? 201 : 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    id: 7,
                    flag_id: 101,
                    ...submittedRolloutPlan,
                    current_phase_index: 0,
                    phase_entered_at: '2026-10-02T12:00:00Z',
                    hold_reason: submittedRolloutPlan.status === 'REVERTED' ? 'manual_revert' : '',
                    hold_started_at: null,
                    recent_samples: [],
                    created_at: '2026-10-02T12:00:00Z',
                }),
            })
            return
        }

        if (pathname.endsWith('/trace/') && request.method() === 'POST') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    enabled: true,
                    variant: 'test',
                    payload: 'layout-v2',
                    reason: 'condition_match',
                    condition_index: 0,
                    trace: [
                        { step: 'flag_active', result: true },
                        {
                            step: 'property',
                            result: true,
                            condition_index: 0,
                            property_index: 0,
                            key: 'country',
                            operator: 'exact',
                            actual: 'BR',
                            expected: 'BR',
                            missing: false,
                        },
                        { step: 'condition', index: 0, filters_pass: true },
                        {
                            step: 'rollout_hash',
                            condition_index: 0,
                            hash_key: 'flag-101.u_7',
                            value: 0.42,
                            threshold: 1,
                            in_rollout: true,
                        },
                        { step: 'variant_hash', value: 0.73, variant: 'test' },
                    ],
                }),
            })
            return
        }

        if (pathname.endsWith('/feature_flags/') && request.method() === 'POST') {
            submittedFlag = request.postDataJSON() as FeatureFlagRequest
            const createdFlag: FeatureFlag = {
                id: 101,
                team_id: 1,
                ...submittedFlag,
                deleted: false,
                version: 1,
                rollout_plan_status: null,
                created_by_id: 1,
                created_at: '2026-10-01T12:00:00Z',
            }
            flags = [createdFlag]
            await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createdFlag) })
            return
        }

        if (pathname.endsWith('/feature_flags/') && request.method() === 'GET') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags) })
            return
        }

        if (pathname.endsWith('/feature_flags/101/') && request.method() === 'GET') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags[0]) })
            return
        }

        await route.abort()
    })

    await page.goto('/feature_flags')
    await page.getByRole('button', { name: 'New flag' }).click()

    await page.getByLabel('Flag key').fill('checkout-redesign')
    await page.getByLabel('Flag name').fill('Checkout redesign')

    await page.getByRole('button', { name: 'Add property' }).click()
    await page.getByLabel('Condition 1 property 1 key').fill('country')
    await page.getByLabel('Condition 1 property 1 value').fill('BR')

    await page.getByRole('button', { name: 'Add condition' }).click()
    await page.getByRole('button', { name: 'Add property' }).nth(1).click()
    await page.getByLabel('Condition 2 property 1 key').fill('plan')
    await page.getByLabel('Condition 2 property 1 value').fill('pro')

    await page.getByLabel('Variant 2 payload').fill('layout-v2')
    await page.getByRole('button', { name: 'Save flag' }).first().click()

    await expect(page.getByRole('heading', { name: 'Edit feature flag' })).toBeVisible()
    const capturedFlag = submittedFlag as FeatureFlagRequest | null
    expect(capturedFlag).not.toBeNull()
    expect(capturedFlag?.filters?.groups).toHaveLength(2)
    expect(capturedFlag?.filters?.multivariate?.variants).toEqual([
        { key: 'control', rollout_percentage: 50 },
        { key: 'test', rollout_percentage: 50 },
    ])

    await page.getByRole('button', { name: 'Open trace' }).click()
    await page.getByLabel('Distinct ID').fill('u_7')
    await page.getByLabel('Properties JSON').fill('{"country":"BR","plan":"pro"}')
    await page.getByRole('button', { name: 'Run trace' }).click()

    await expect(page.getByText('condition_match')).toBeVisible()
    await expect(page.getByText('Variant hash selected test.')).toBeVisible()

    await page.getByRole('button', { name: '← Edit flag' }).click()
    await page.getByRole('button', { name: 'Activate' }).click()
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible()
    const capturedRolloutPlan = submittedRolloutPlan as RolloutPlanRequest | null
    expect(capturedRolloutPlan?.managed_group_index).toBe(0)
    expect(capturedRolloutPlan?.phases.map((phase) => phase.percentage)).toEqual([1, 10, 50, 100])

    await page.getByRole('button', { name: 'Revert' }).click()
    await expect(page.getByText('REVERTED', { exact: true })).toBeVisible()
    const revertedRolloutPlan = submittedRolloutPlan as RolloutPlanRequest | null
    expect(revertedRolloutPlan?.status).toBe('REVERTED')
})
