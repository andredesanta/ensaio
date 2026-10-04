import { actions, afterMount, kea, key, listeners, path, props, reducers } from 'kea'
import { loaders } from 'kea-loaders'

import { ApiError, apiErrorMessage } from './apiClient'
import {
    projectsFeatureFlagsRolloutPlanDestroy,
    projectsFeatureFlagsRolloutPlanRetrieve,
    projectsFeatureFlagsRolloutPlanUpdate,
} from './generated/api'
import type {
    ProjectsFeatureFlagsRolloutPlanDestroyParams,
    RolloutPlan,
    RolloutPlanMutationRequest,
} from './generated/models'
import { ComparisonEnum, RolloutStatusEnum } from './generated/models'
import type { rolloutPlanLogicType } from './rolloutPlanLogicType'

export type RolloutPlanLogicProps = {
    teamId: number
    flagId: number
}

function loaderErrorMessage(error: string, errorObject: unknown): string {
    return errorObject === undefined ? error : apiErrorMessage(errorObject)
}

function isRolloutPlanAbsence(error: unknown): boolean {
    if (!(error instanceof ApiError) || error.status !== 404 || typeof error.body !== 'object' || error.body === null) {
        return false
    }
    return 'code' in error.body && error.body.code === 'rollout_plan_not_found'
}

export function newRolloutPlan(): RolloutPlanMutationRequest {
    return {
        expected_plan_id: null,
        expected_version: null,
        status: RolloutStatusEnum.DRAFT,
        managed_group_index: 0,
        phases: [
            { percentage: 1, min_duration_minutes: 5 },
            { percentage: 10, min_duration_minutes: 10 },
            { percentage: 50, min_duration_minutes: 15 },
            { percentage: 100, min_duration_minutes: 30 },
        ],
        guardrail: {
            name: 'error_rate',
            comparison: ComparisonEnum.lt,
            threshold: 0.02,
            window_minutes: 15,
            min_samples: 100,
            max_hold_minutes: 30,
        },
    }
}

export function rolloutPlanToRequest(plan: RolloutPlan): RolloutPlanMutationRequest {
    return {
        expected_plan_id: plan.id,
        expected_version: plan.version,
        status: plan.status,
        managed_group_index: plan.managed_group_index,
        phases: plan.phases.map((phase) => ({ ...phase })),
        guardrail: { ...plan.guardrail },
    }
}

export const rolloutPlanLogic = kea<rolloutPlanLogicType>([
    props({} as RolloutPlanLogicProps),
    key((logicProps) => `${logicProps.teamId}-${logicProps.flagId}`),
    path((logicKey) => ['products', 'featureFlags', 'rolloutPlanLogic', logicKey]),
    actions({
        setRolloutDraft: (draft: RolloutPlanMutationRequest) => ({ draft }),
        setPlanError: (error: string | null) => ({ error }),
    }),
    reducers({
        rolloutDraft: [
            newRolloutPlan(),
            {
                setRolloutDraft: (_, { draft }) => draft,
            },
        ],
        planError: [
            null as string | null,
            {
                setPlanError: (_, { error }) => error,
            },
        ],
    }),
    loaders(({ props: logicProps }) => ({
        rolloutPlan: [
            null as RolloutPlan | null,
            {
                loadRolloutPlan: async () => {
                    try {
                        const response = await projectsFeatureFlagsRolloutPlanRetrieve(
                            logicProps.teamId,
                            logicProps.flagId
                        )
                        if (response.status !== 200) {
                            throw new ApiError(response.status, response.data)
                        }
                        return response.data
                    } catch (error) {
                        if (isRolloutPlanAbsence(error)) {
                            return null
                        }
                        throw error
                    }
                },
                saveRolloutPlan: async (request: RolloutPlanMutationRequest) => {
                    const response = await projectsFeatureFlagsRolloutPlanUpdate(
                        logicProps.teamId,
                        logicProps.flagId,
                        request
                    )
                    return response.data
                },
                deleteRolloutPlan: async (request: ProjectsFeatureFlagsRolloutPlanDestroyParams) => {
                    await projectsFeatureFlagsRolloutPlanDestroy(logicProps.teamId, logicProps.flagId, request)
                    return null
                },
            },
        ],
    })),
    listeners(({ actions: logicActions }) => ({
        loadRolloutPlan: () => {
            logicActions.setPlanError(null)
        },
        loadRolloutPlanSuccess: ({ rolloutPlan }) => {
            logicActions.setRolloutDraft(rolloutPlan === null ? newRolloutPlan() : rolloutPlanToRequest(rolloutPlan))
        },
        loadRolloutPlanFailure: ({ error, errorObject }) => {
            logicActions.setPlanError(loaderErrorMessage(error, errorObject))
        },
        saveRolloutPlan: () => {
            logicActions.setPlanError(null)
        },
        saveRolloutPlanSuccess: ({ rolloutPlan }) => {
            if (rolloutPlan !== null) {
                logicActions.setRolloutDraft(rolloutPlanToRequest(rolloutPlan))
            }
        },
        saveRolloutPlanFailure: ({ error, errorObject }) => {
            logicActions.setPlanError(loaderErrorMessage(error, errorObject))
        },
        deleteRolloutPlanSuccess: () => {
            logicActions.setRolloutDraft(newRolloutPlan())
        },
        deleteRolloutPlanFailure: ({ error, errorObject }) => {
            logicActions.setPlanError(loaderErrorMessage(error, errorObject))
        },
    })),
    afterMount(({ actions: logicActions }) => {
        logicActions.loadRolloutPlan()
    }),
])
