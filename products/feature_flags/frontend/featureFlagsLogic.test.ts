import { expectLogic } from 'kea-test-utils'

import { projectsFeatureFlagsDisableCreate, projectsFeatureFlagsList } from './generated/api'
import { featureFlagsLogic } from './featureFlagsLogic'
import { featureFlagFixture } from './testFixtures'
import { resetKeaTestContext } from './testSetup'

jest.mock('./generated/api', () => ({
    projectsFeatureFlagsDisableCreate: jest.fn(),
    projectsFeatureFlagsEnableCreate: jest.fn(),
    projectsFeatureFlagsList: jest.fn(),
}))

const mockList = jest.mocked(projectsFeatureFlagsList)
const mockDisable = jest.mocked(projectsFeatureFlagsDisableCreate)

describe('featureFlagsLogic', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        resetKeaTestContext()
    })

    test('loads and filters feature flags', async () => {
        const checkout = featureFlagFixture()
        const pricing = featureFlagFixture({ id: 2, key: 'pricing-page', name: 'Pricing page' })
        mockList.mockResolvedValue({ data: [checkout, pricing] } as never)

        const logic = featureFlagsLogic({ teamId: 1 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        expectLogic(logic).toMatchValues({ featureFlags: [checkout, pricing], loadError: null })
        logic.actions.setSearch('pricing')
        expectLogic(logic).toMatchValues({ filteredFlags: [pricing] })
        unmount()
    })

    test('exposes list loader failures', async () => {
        mockList.mockRejectedValue(new Error('Network unavailable'))

        const logic = featureFlagsLogic({ teamId: 1 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        expect(logic.values.loadError).toContain('Network unavailable')
        unmount()
    })

    test('uses the dedicated disable action and reloads the list', async () => {
        const flag = featureFlagFixture()
        mockList.mockResolvedValue({ data: [flag] } as never)
        mockDisable.mockResolvedValue({ data: { ...flag, active: false } } as never)

        const logic = featureFlagsLogic({ teamId: 1 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        logic.actions.toggleFlagActive(flag.id, false)
        await expectLogic(logic).toFinishAllListeners()

        expect(mockDisable).toHaveBeenCalledWith(1, flag.id)
        expect(mockList).toHaveBeenCalledTimes(2)
        unmount()
    })
})
