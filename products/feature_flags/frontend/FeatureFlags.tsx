import { useActions, useValues } from 'kea'
import { router } from 'kea-router'
import type { ChangeEvent, ReactElement } from 'react'

import { Button, ErrorBanner, Input, Switch, Tag } from '../../../frontend/src/lib/ui'
import { urls } from '../manifest'
import { featureFlagsLogic } from './featureFlagsLogic'

type FeatureFlagsProps = {
    teamId: number
}

export function FeatureFlags({ teamId }: FeatureFlagsProps): ReactElement {
    const logic = featureFlagsLogic({ teamId })
    const { filteredFlags, search, featureFlagsLoading, loadError, mutationError } = useValues(logic)
    const { setSearch, toggleFlagActive } = useActions(logic)

    return (
        <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
            <div className="mx-auto max-w-6xl space-y-6">
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold text-fuchsia-700">Ensaio</p>
                        <h1 className="text-3xl font-bold">Feature flags</h1>
                        <p className="mt-1 text-sm text-slate-600">Control releases and inspect every decision.</p>
                    </div>
                    <Button variant="primary" onClick={() => router.actions.push(urls.featureFlagNew())}>
                        New flag
                    </Button>
                </header>

                {loadError !== null ? <ErrorBanner>{loadError}</ErrorBanner> : null}
                {mutationError !== null ? <ErrorBanner>{mutationError}</ErrorBanner> : null}

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 p-4">
                        <Input
                            aria-label="Search flags"
                            className="max-w-md"
                            placeholder="Search by key or name"
                            value={search}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
                        />
                    </div>

                    {featureFlagsLoading ? (
                        <p className="p-8 text-center text-sm text-slate-600">Loading feature flags…</p>
                    ) : filteredFlags.length === 0 ? (
                        <div className="p-10 text-center">
                            <p className="font-semibold">No feature flags found</p>
                            <p className="mt-1 text-sm text-slate-600">
                                {search === '' ? 'Create your first flag to begin.' : 'Try a different search.'}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th className="px-4 py-3">Flag</th>
                                        <th className="px-4 py-3">Targeting</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {filteredFlags.map((flag) => (
                                        <tr key={flag.id}>
                                            <td className="px-4 py-4">
                                                <button
                                                    className="font-mono font-semibold text-fuchsia-700 hover:underline"
                                                    onClick={() => router.actions.push(urls.featureFlag(flag.id))}
                                                >
                                                    {flag.key}
                                                </button>
                                                {flag.name !== undefined && flag.name !== '' ? (
                                                    <p className="mt-1 text-slate-600">{flag.name}</p>
                                                ) : null}
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex flex-wrap gap-2">
                                                    <Tag>{flag.filters?.groups.length ?? 0} conditions</Tag>
                                                    <Tag>
                                                        {(flag.filters?.groups ?? [])
                                                            .map(
                                                                (condition) => `${condition.rollout_percentage ?? 100}%`
                                                            )
                                                            .join(' / ') || '—'}{' '}
                                                        rollout
                                                    </Tag>
                                                    <Tag>
                                                        {flag.filters?.multivariate?.variants.length ?? 0} variants
                                                    </Tag>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <Switch
                                                    label={flag.active === false ? 'Inactive' : 'Active'}
                                                    checked={flag.active !== false}
                                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                                        toggleFlagActive(flag.id, event.target.checked)
                                                    }
                                                />
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        variant="quiet"
                                                        onClick={() => router.actions.push(urls.trace(flag.id))}
                                                    >
                                                        Trace
                                                    </Button>
                                                    <Button
                                                        onClick={() => router.actions.push(urls.featureFlag(flag.id))}
                                                    >
                                                        Edit
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </main>
    )
}
