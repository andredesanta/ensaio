import { actions, afterMount, kea, key, listeners, path, props, reducers, selectors } from 'kea'
import { loaders } from 'kea-loaders'

import { apiErrorMessage } from './apiClient'
import { projectsFeatureFlagsList, projectsFeatureFlagsPartialUpdate } from './generated/api'
import type { FeatureFlag } from './generated/models'
import type { featureFlagsLogicType } from './featureFlagsLogicType'

export type FeatureFlagsLogicProps = {
    teamId: number
}

export const featureFlagsLogic = kea<featureFlagsLogicType>([
    props({} as FeatureFlagsLogicProps),
    key((logicProps) => logicProps.teamId),
    path((logicKey) => ['products', 'featureFlags', 'featureFlagsLogic', logicKey]),
    actions({
        setSearch: (search: string) => ({ search }),
        toggleFlagActive: (id: number, active: boolean) => ({ id, active }),
        setMutationError: (error: string | null) => ({ error }),
        setLoadError: (error: string | null) => ({ error }),
    }),
    reducers({
        search: [
            '',
            {
                setSearch: (_, { search }) => search,
            },
        ],
        mutationError: [
            null as string | null,
            {
                setMutationError: (_, { error }) => error,
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
        featureFlags: [
            [] as FeatureFlag[],
            {
                loadFeatureFlags: async () => {
                    const response = await projectsFeatureFlagsList(logicProps.teamId)
                    return response.data
                },
            },
        ],
    })),
    listeners(({ actions: logicActions, props: logicProps }) => ({
        loadFeatureFlags: () => {
            logicActions.setLoadError(null)
        },
        loadFeatureFlagsFailure: ({ error }) => {
            logicActions.setLoadError(error)
        },
        toggleFlagActive: async ({ id, active }) => {
            logicActions.setMutationError(null)
            try {
                await projectsFeatureFlagsPartialUpdate(logicProps.teamId, id, { active })
                logicActions.loadFeatureFlags()
            } catch (error) {
                logicActions.setMutationError(apiErrorMessage(error))
            }
        },
    })),
    selectors({
        filteredFlags: [
            (logicSelectors) => [logicSelectors.featureFlags, logicSelectors.search],
            (featureFlags: FeatureFlag[], search: string): FeatureFlag[] => {
                const normalizedSearch = search.trim().toLocaleLowerCase()
                if (normalizedSearch === '') {
                    return featureFlags
                }
                return featureFlags.filter(
                    (flag) =>
                        flag.key.toLocaleLowerCase().includes(normalizedSearch) ||
                        (flag.name ?? '').toLocaleLowerCase().includes(normalizedSearch)
                )
            },
        ],
    }),
    afterMount(({ actions: logicActions }) => {
        logicActions.loadFeatureFlags()
    }),
])
