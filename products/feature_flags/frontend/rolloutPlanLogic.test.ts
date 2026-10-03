import { expectLogic } from 'kea-test-utils'

import { ApiError } from './apiClient'
import {
    projectsFeatureFlagsRolloutPlanDestroy,
    projectsFeatureFlagsRolloutPlanRetrieve,
    projectsFeatureFlagsRolloutPlanUpdate,
} from './generated/api'
import type { RolloutPlan } from './generated/models'
import { ComparisonEnum, RolloutStatusEnum } from './generated/models'
import { newRolloutPlan, rolloutPlanLogic } from './rolloutPlanLogic'
import { resetKeaTestContext } from './testSetup'

jest.mock('./generated/api', () => ({
    projectsFeatureFlagsRolloutPlanDestroy: jest.fn(),
    projectsFeatureFlagsRolloutPlanRetrieve: jest.fn(),
    projectsFeatureFlagsRolloutPlanUpdate: jest.fn(),
}))

const mockDestroy = jest.mocked(projectsFeatureFlagsRolloutPlanDestroy)
const mockRetrieve = jest.mocked(projectsFeatureFlagsRolloutPlanRetrieve)
const mockUpdate = jest.mocked(projectsFeatureFlagsRolloutPlanUpdate)

function rolloutPlanFixture(): RolloutPlan {
    return {
        id: 4,
        flag_id: 1,
        status: RolloutStatusEnum.ACTIVE,
        managed_group_index: 0,
        phases: [
            { percentage: 10, min_duration_minutes: 5 },
            { percentage: 50, min_duration_minutes: 10 },
        ],
        current_phase_index: 0,
        phase_entered_at: '2026-10-02T12:00:00Z',
        hold_reason: '',
        hold_started_at: null,
        guardrail: {
            name: 'error_rate',
            comparison: ComparisonEnum.lt,
            threshold: 0.02,
            window_minutes: 15,
            min_samples: 100,
            max_hold_minutes: 30,
        },
        recent_samples: [],
        created_at: '2026-10-02T12:00:00Z',
    }
}

describe('rolloutPlanLogic', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        resetKeaTestContext()
    })

    test('loads an existing plan into editable Kea state', async () => {
        const plan = rolloutPlanFixture()
        mockRetrieve.mockResolvedValue({ data: plan } as never)

        const logic = rolloutPlanLogic({ teamId: 1, flagId: 1 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        expect(logic.values.rolloutPlan).toEqual(plan)
        expect(logic.values.rolloutDraft.phases).toEqual(plan.phases)
        expect(logic.values.rolloutDraft.guardrail).toEqual(plan.guardrail)
        unmount()
    })

    test('treats a missing plan as an empty draft instead of an error', async () => {
        mockRetrieve.mockRejectedValue(new ApiError(404, undefined))

        const logic = rolloutPlanLogic({ teamId: 1, flagId: 1 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        expect(logic.values.rolloutPlan).toBeNull()
        expect(logic.values.rolloutDraft).toEqual(newRolloutPlan())
        expect(logic.values.planError).toBeNull()
        unmount()
    })

    test('exposes rollout loader failures', async () => {
        mockRetrieve.mockRejectedValue(new ApiError(500, { detail: 'Rollout plan unavailable.' }))

        const logic = rolloutPlanLogic({ teamId: 1, flagId: 1 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        expect(logic.values.planError).toContain('Rollout plan unavailable.')
        unmount()
    })

    test('save and delete listeners keep the persisted plan and draft synchronized', async () => {
        const plan = rolloutPlanFixture()
        mockRetrieve.mockResolvedValue({ data: null } as never)
        mockUpdate.mockResolvedValue({ data: plan } as never)
        mockDestroy.mockResolvedValue({ data: undefined } as never)

        const logic = rolloutPlanLogic({ teamId: 1, flagId: 1 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        logic.actions.saveRolloutPlan({ ...newRolloutPlan(), status: RolloutStatusEnum.ACTIVE })
        await expectLogic(logic).toFinishAllListeners()
        expect(logic.values.rolloutPlan).toEqual(plan)
        expect(logic.values.rolloutDraft.status).toBe(RolloutStatusEnum.ACTIVE)

        logic.actions.deleteRolloutPlan()
        await expectLogic(logic).toFinishAllListeners()
        expect(logic.values.rolloutPlan).toBeNull()
        expect(logic.values.rolloutDraft).toEqual(newRolloutPlan())
        unmount()
    })
})
