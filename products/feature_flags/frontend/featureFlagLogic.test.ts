import { router } from 'kea-router'
import { expectLogic } from 'kea-test-utils'

import { projectsFeatureFlagsPartialUpdate, projectsFeatureFlagsRetrieve } from './generated/api'
import { featureFlagLogic } from './featureFlagLogic'
import { featureFlagFixture } from './testFixtures'
import { resetKeaTestContext } from './testSetup'

jest.mock('./generated/api', () => ({
    projectsFeatureFlagsCreate: jest.fn(),
    projectsFeatureFlagsPartialUpdate: jest.fn(),
    projectsFeatureFlagsRetrieve: jest.fn(),
}))

const mockRetrieve = jest.mocked(projectsFeatureFlagsRetrieve)
const mockPartialUpdate = jest.mocked(projectsFeatureFlagsPartialUpdate)

describe('featureFlagLogic', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        resetKeaTestContext()
    })

    test('loads an existing flag into the Kea form', async () => {
        const flag = featureFlagFixture()
        mockRetrieve.mockResolvedValue({ data: flag } as never)

        const logic = featureFlagLogic({ teamId: 1, flagId: flag.id })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        expectLogic(logic).toDispatchActions(['loadFeatureFlag', 'loadFeatureFlagSuccess', 'resetFlagForm'])
        expect(logic.values.featureFlag).toEqual(flag)
        expect(logic.values.flagForm.key).toBe(flag.key)
        expect(logic.values.flagForm.filters?.multivariate?.variants).toEqual(flag.filters?.multivariate?.variants)
        unmount()
    })

    test('exposes detail loader failures', async () => {
        mockRetrieve.mockRejectedValue(new Error('Flag could not be loaded'))

        const logic = featureFlagLogic({ teamId: 1, flagId: 99 })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        expect(logic.values.loadError).toContain('Flag could not be loaded')
        unmount()
    })

    test('navigates to the persisted flag after the save listener runs', async () => {
        const flag = featureFlagFixture({ id: 42 })
        const logic = featureFlagLogic({ teamId: 1, flagId: 'new' })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        logic.actions.flagSaved(flag)
        await expectLogic(logic).toFinishAllListeners()

        expect(router.values.location.pathname).toBe('/feature_flags/42')
        unmount()
    })

    test('uses the returned version for a second consecutive edit', async () => {
        const first = featureFlagFixture({ version: 1 })
        const second = featureFlagFixture({ version: 2, name: 'First edit' })
        const third = featureFlagFixture({ version: 3, name: 'Second edit' })
        mockRetrieve.mockResolvedValue({ data: first } as never)
        mockPartialUpdate
            .mockResolvedValueOnce({ data: second } as never)
            .mockResolvedValueOnce({ data: third } as never)

        const logic = featureFlagLogic({ teamId: 1, flagId: first.id })
        const unmount = logic.mount()
        await expectLogic(logic).toFinishAllListeners()

        logic.actions.setFlagFormValue('name', 'First edit')
        logic.actions.submitFlagForm()
        await expectLogic(logic).toFinishAllListeners()
        expect(logic.values.flagForm.expected_version).toBe(2)

        logic.actions.setFlagFormValue('name', 'Second edit')
        logic.actions.submitFlagForm()
        await expectLogic(logic).toFinishAllListeners()

        expect(mockPartialUpdate.mock.calls[0]?.[2]?.expected_version).toBe(1)
        expect(mockPartialUpdate.mock.calls[1]?.[2]?.expected_version).toBe(2)
        expect(logic.values.flagForm.expected_version).toBe(3)
        unmount()
    })
})
