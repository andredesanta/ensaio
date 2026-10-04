import { actions, afterMount, kea, key, listeners, path, props, reducers } from 'kea'
import { forms } from 'kea-forms'
import { loaders } from 'kea-loaders'
import { router } from 'kea-router'

import { urls } from '../manifest'
import { apiErrorMessage } from './apiClient'
import { featureFlagToRequest, flagFormErrors, newFeatureFlag } from './flagForm'
import type { FeatureFlagForm } from './flagForm'
import {
    projectsFeatureFlagsCreate,
    projectsFeatureFlagsPartialUpdate,
    projectsFeatureFlagsRetrieve,
} from './generated/api'
import type { FeatureFlag } from './generated/models'
import type { featureFlagLogicType } from './featureFlagLogicType'

export type FeatureFlagLogicProps = {
    teamId: number
    flagId: number | 'new'
}

function requiredExpectedVersion(value: number | undefined): number {
    if (value === undefined) {
        throw new Error('Reload the flag before saving because its version is missing.')
    }
    return value
}

export const featureFlagLogic = kea<featureFlagLogicType>([
    props({} as FeatureFlagLogicProps),
    key((logicProps) => `${logicProps.teamId}-${logicProps.flagId}`),
    path((logicKey) => ['products', 'featureFlags', 'featureFlagLogic', logicKey]),
    actions({
        flagSaved: (flag: FeatureFlag) => ({ flag }),
        setSaveError: (error: string | null) => ({ error }),
        setLoadError: (error: string | null) => ({ error }),
    }),
    reducers({
        saveError: [
            null as string | null,
            {
                setSaveError: (_, { error }) => error,
            },
        ],
        loadError: [
            null as string | null,
            {
                setLoadError: (_, { error }) => error,
            },
        ],
    }),
    loaders(({ props: logicProps }) => ({
        featureFlag: [
            null as FeatureFlag | null,
            {
                loadFeatureFlag: async () => {
                    if (logicProps.flagId === 'new') {
                        return null
                    }
                    const response = await projectsFeatureFlagsRetrieve(logicProps.teamId, logicProps.flagId)
                    return response.data
                },
            },
        ],
    })),
    forms(({ actions: logicActions, props: logicProps }) => ({
        flagForm: {
            defaults: newFeatureFlag(),
            errors: flagFormErrors,
            submit: async (formValues: FeatureFlagForm) => {
                logicActions.setSaveError(null)
                try {
                    const { expected_version: expectedVersion, ...createRequest } = formValues
                    const response =
                        logicProps.flagId === 'new'
                            ? await projectsFeatureFlagsCreate(logicProps.teamId, createRequest)
                            : await projectsFeatureFlagsPartialUpdate(logicProps.teamId, logicProps.flagId, {
                                  ...formValues,
                                  expected_version: requiredExpectedVersion(expectedVersion),
                              })
                    const savedForm = featureFlagToRequest(response.data)
                    logicActions.resetFlagForm(savedForm)
                    logicActions.flagSaved(response.data)
                    return savedForm
                } catch (error) {
                    logicActions.setSaveError(apiErrorMessage(error))
                    throw error
                }
            },
        },
    })),
    listeners(({ actions: logicActions }) => ({
        loadFeatureFlag: () => {
            logicActions.setLoadError(null)
        },
        loadFeatureFlagFailure: ({ error }) => {
            logicActions.setLoadError(error)
        },
        loadFeatureFlagSuccess: ({ featureFlag }) => {
            logicActions.resetFlagForm(featureFlag === null ? newFeatureFlag() : featureFlagToRequest(featureFlag))
        },
        flagSaved: ({ flag }) => {
            router.actions.push(urls.featureFlag(flag.id))
        },
    })),
    afterMount(({ actions: logicActions }) => {
        logicActions.loadFeatureFlag()
    }),
])
