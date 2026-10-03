import { expectLogic } from 'kea-test-utils'

import { projectsFeatureFlagsTraceCreate } from './generated/api'
import { traceLogic } from './traceLogic'
import { evaluationResultFixture } from './testFixtures'
import { resetKeaTestContext } from './testSetup'

jest.mock('./generated/api', () => ({
    projectsFeatureFlagsTraceCreate: jest.fn(),
}))

const mockTrace = jest.mocked(projectsFeatureFlagsTraceCreate)

describe('traceLogic', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        resetKeaTestContext()
    })

    test('loads an evaluation trace', async () => {
        const result = evaluationResultFixture()
        mockTrace.mockResolvedValue({ data: result } as never)
        const logic = traceLogic({ teamId: 1, flagId: 7 })
        const unmount = logic.mount()

        logic.actions.runTrace({ distinct_id: 'u_7', properties: { country: 'BR' } })
        await expectLogic(logic).toFinishAllListeners()

        expectLogic(logic).toMatchValues({ traceResult: result, traceError: null })
        unmount()
    })

    test('exposes trace loader failures', async () => {
        mockTrace.mockRejectedValue(new Error('Trace request failed'))
        const logic = traceLogic({ teamId: 1, flagId: 7 })
        const unmount = logic.mount()

        logic.actions.runTrace({ distinct_id: 'u_7', properties: {} })
        await expectLogic(logic).toFinishAllListeners()

        expect(logic.values.traceError).toContain('Trace request failed')
        unmount()
    })

    test('submit listener parses properties before dispatching the loader', async () => {
        mockTrace.mockResolvedValue({ data: evaluationResultFixture() } as never)
        const logic = traceLogic({ teamId: 3, flagId: 9 })
        const unmount = logic.mount()

        logic.actions.setDistinctId('person-123')
        logic.actions.setPropertiesText('{"country":"BR","plan":"pro"}')
        logic.actions.submitTrace()
        await expectLogic(logic).toFinishAllListeners()

        expect(mockTrace).toHaveBeenCalledWith(3, 9, {
            distinct_id: 'person-123',
            properties: { country: 'BR', plan: 'pro' },
        })
        expect(logic.values.inputError).toBeNull()
        unmount()
    })
})
