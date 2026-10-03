import { actions, kea, key, listeners, path, props, reducers } from 'kea'
import { loaders } from 'kea-loaders'

import { projectsFeatureFlagsTraceCreate } from './generated/api'
import type { EvaluationResult, TraceRequestRequest } from './generated/models'
import type { traceLogicType } from './traceLogicType'

export type TraceLogicProps = {
    teamId: number
    flagId: number
}

export const traceLogic = kea<traceLogicType>([
    props({} as TraceLogicProps),
    key((logicProps) => `${logicProps.teamId}-${logicProps.flagId}`),
    path((logicKey) => ['products', 'featureFlags', 'traceLogic', logicKey]),
    actions({
        setDistinctId: (distinctId: string) => ({ distinctId }),
        setPropertiesText: (propertiesText: string) => ({ propertiesText }),
        submitTrace: true,
        setInputError: (inputError: string | null) => ({ inputError }),
        setTraceError: (traceError: string | null) => ({ traceError }),
    }),
    reducers({
        distinctId: [
            'u_7',
            {
                setDistinctId: (_, { distinctId }) => distinctId,
            },
        ],
        propertiesText: [
            '{\n    "country": "BR"\n}',
            {
                setPropertiesText: (_, { propertiesText }) => propertiesText,
            },
        ],
        inputError: [
            null as string | null,
            {
                setInputError: (_, { inputError }) => inputError,
            },
        ],
        traceError: [
            null as string | null,
            {
                setTraceError: (_, { traceError }) => traceError,
            },
        ],
    }),
    loaders(({ props: logicProps }) => ({
        traceResult: [
            null as EvaluationResult | null,
            {
                runTrace: async (request: TraceRequestRequest) => {
                    const response = await projectsFeatureFlagsTraceCreate(
                        logicProps.teamId,
                        logicProps.flagId,
                        request
                    )
                    return response.data
                },
            },
        ],
    })),
    listeners(({ actions: logicActions, values }) => ({
        runTrace: () => {
            logicActions.setTraceError(null)
        },
        runTraceFailure: ({ error }) => {
            logicActions.setTraceError(error)
        },
        submitTrace: () => {
            try {
                const properties: unknown = JSON.parse(values.propertiesText)
                if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
                    throw new Error('Properties must be a JSON object.')
                }
                logicActions.setInputError(null)
                logicActions.runTrace({
                    distinct_id: values.distinctId,
                    properties: properties as Record<string, unknown>,
                })
            } catch (error) {
                logicActions.setInputError(error instanceof Error ? error.message : 'Properties must be valid JSON.')
            }
        },
    })),
])
