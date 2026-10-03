import { useActions, useValues } from 'kea'
import { router } from 'kea-router'
import type { ChangeEvent, FormEvent, ReactElement } from 'react'

import { Button, Card, ErrorBanner, Field, Input, Switch } from '../../../frontend/src/lib/ui'
import { urls } from '../manifest'
import { ConditionSetCard } from './components/ConditionSetCard'
import { RolloutPlanCard } from './components/RolloutPlanCard'
import { VariantEditor } from './components/VariantEditor'
import { featureFlagLogic } from './featureFlagLogic'
import { flagFormErrors, newCondition } from './flagForm'
import type { FiltersRequest, FiltersRequestPayloads, VariantRequest } from './generated/models'

type FeatureFlagProps = {
    teamId: number
    flagId: number | 'new'
}

export function FeatureFlag({ teamId, flagId }: FeatureFlagProps): ReactElement {
    const logic = featureFlagLogic({ teamId, flagId })
    const { flagForm, featureFlagLoading, loadError, isFlagFormSubmitting, saveError } = useValues(logic)
    const { setFlagFormValue, submitFlagForm } = useActions(logic)
    const errors = flagFormErrors(flagForm)

    const filters: FiltersRequest = flagForm.filters ?? {
        groups: [],
        multivariate: { variants: [] },
        payloads: {},
    }
    const variants = filters.multivariate?.variants ?? []
    const payloads = filters.payloads ?? {}

    const setFilters = (nextFilters: FiltersRequest): void => {
        setFlagFormValue('filters', nextFilters)
    }

    const setVariants = (nextVariants: VariantRequest[], nextPayloads: FiltersRequestPayloads): void => {
        setFilters({
            ...filters,
            multivariate: { variants: nextVariants },
            payloads: nextPayloads,
        })
    }

    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        submitFlagForm()
    }

    return (
        <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
            <form className="mx-auto max-w-4xl space-y-6" onSubmit={submit}>
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <button
                            className="mb-2 text-sm font-medium text-fuchsia-700 hover:underline"
                            type="button"
                            onClick={() => router.actions.push(urls.featureFlags())}
                        >
                            ← Feature flags
                        </button>
                        <h1 className="text-3xl font-bold">
                            {flagId === 'new' ? 'New feature flag' : 'Edit feature flag'}
                        </h1>
                    </div>
                    <div className="flex gap-2">
                        {flagId !== 'new' ? (
                            <Button type="button" onClick={() => router.actions.push(urls.trace(flagId))}>
                                Open trace
                            </Button>
                        ) : null}
                        <Button type="submit" variant="primary" disabled={featureFlagLoading || isFlagFormSubmitting}>
                            {isFlagFormSubmitting ? 'Saving…' : 'Save flag'}
                        </Button>
                    </div>
                </header>

                {loadError !== null ? <ErrorBanner>{loadError}</ErrorBanner> : null}
                {saveError !== null ? <ErrorBanner>{saveError}</ErrorBanner> : null}

                {featureFlagLoading ? (
                    <Card>
                        <p className="text-sm text-slate-600">Loading feature flag…</p>
                    </Card>
                ) : (
                    <>
                        <Card title="Basics">
                            <div className="grid gap-5 md:grid-cols-2">
                                <Field
                                    label="Key"
                                    error={errors.key}
                                    hint="Stable identifier used by SDKs and the evaluation API."
                                >
                                    <Input
                                        aria-label="Flag key"
                                        value={flagForm.key}
                                        placeholder="checkout-redesign"
                                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                            setFlagFormValue('key', event.target.value)
                                        }
                                    />
                                </Field>
                                <Field label="Name" hint="Human-readable context for teammates.">
                                    <Input
                                        aria-label="Flag name"
                                        value={flagForm.name ?? ''}
                                        placeholder="Checkout redesign"
                                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                            setFlagFormValue('name', event.target.value)
                                        }
                                    />
                                </Field>
                            </div>
                            <div className="mt-5">
                                <Switch
                                    label="Flag is active"
                                    checked={flagForm.active !== false}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                        setFlagFormValue('active', event.target.checked)
                                    }
                                />
                            </div>
                        </Card>

                        <div className="space-y-4">
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <h2 className="text-xl font-semibold">Conditions</h2>
                                    <p className="text-sm text-slate-600">
                                        Conditions are checked in order. Every property in a condition must match.
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    onClick={() =>
                                        setFilters({ ...filters, groups: [...filters.groups, newCondition()] })
                                    }
                                >
                                    Add condition
                                </Button>
                            </div>
                            {errors.filters !== undefined ? (
                                <p className="text-sm text-red-700">{errors.filters}</p>
                            ) : null}
                            {filters.groups.map((condition, index) => (
                                <ConditionSetCard
                                    key={index}
                                    index={index}
                                    condition={condition}
                                    canRemove={filters.groups.length > 1}
                                    onChange={(nextCondition) =>
                                        setFilters({
                                            ...filters,
                                            groups: filters.groups.map((current, currentIndex) =>
                                                currentIndex === index ? nextCondition : current
                                            ),
                                        })
                                    }
                                    onRemove={() =>
                                        setFilters({
                                            ...filters,
                                            groups: filters.groups.filter((_, currentIndex) => currentIndex !== index),
                                        })
                                    }
                                />
                            ))}
                        </div>

                        <VariantEditor
                            variants={variants}
                            payloads={payloads}
                            error={errors.variants}
                            onChange={setVariants}
                        />

                        {flagId !== 'new' ? <RolloutPlanCard teamId={teamId} flagId={flagId} /> : null}

                        <div className="flex justify-end gap-2">
                            <Button type="button" onClick={() => router.actions.push(urls.featureFlags())}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="primary" disabled={isFlagFormSubmitting}>
                                {isFlagFormSubmitting ? 'Saving…' : 'Save flag'}
                            </Button>
                        </div>
                    </>
                )}
            </form>
        </main>
    )
}
