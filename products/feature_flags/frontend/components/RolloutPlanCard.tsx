import { useActions, useValues } from 'kea'
import type { ChangeEvent, ReactElement } from 'react'

import { Button, Card, ErrorBanner, Field, Input, Select, Tag } from '../../../../frontend/src/lib/ui'
import type { RolloutPlanMutationRequest } from '../generated/models'
import { ComparisonEnum, RolloutStatusEnum } from '../generated/models'
import { rolloutPlanLogic } from '../rolloutPlanLogic'

type RolloutPlanCardProps = {
    teamId: number
    flagId: number
}

function numberValue(event: ChangeEvent<HTMLInputElement>): number {
    return Number(event.target.value)
}

export function RolloutPlanCard({ teamId, flagId }: RolloutPlanCardProps): ReactElement {
    const logic = rolloutPlanLogic({ teamId, flagId })
    const { rolloutPlan, rolloutDraft, rolloutPlanLoading, planError } = useValues(logic)
    const { setRolloutDraft, saveRolloutPlan, deleteRolloutPlan } = useActions(logic)

    const updateDraft = (changes: Partial<RolloutPlanMutationRequest>): void => {
        setRolloutDraft({ ...rolloutDraft, ...changes })
    }

    const saveWithStatus = (status: RolloutStatusEnum): void => {
        saveRolloutPlan({ ...rolloutDraft, status })
    }

    return (
        <Card
            title="Health-gated rollout"
            actions={<Tag>{rolloutPlan?.status ?? RolloutStatusEnum.DRAFT}</Tag>}
            className="space-y-5"
        >
            {planError !== null ? <ErrorBanner>{planError}</ErrorBanner> : null}
            {rolloutPlanLoading && rolloutPlan === null ? (
                <p className="text-sm text-slate-600">Loading rollout plan…</p>
            ) : (
                <>
                    <p className="text-sm text-slate-600">
                        One condition group advances through these phases only when its absolute guardrail is healthy.
                        Missing evidence holds, then pauses, the rollout.
                    </p>

                    <Field label="Managed condition" hint="Zero-based index into the flag's ordered condition groups.">
                        <Input
                            aria-label="Managed condition"
                            min={0}
                            type="number"
                            value={rolloutDraft.managed_group_index}
                            onChange={(event) => updateDraft({ managed_group_index: numberValue(event) })}
                        />
                    </Field>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-slate-900">Phases</h3>
                            <Button
                                onClick={() =>
                                    updateDraft({
                                        phases: [...rolloutDraft.phases, { percentage: 100, min_duration_minutes: 15 }],
                                    })
                                }
                            >
                                Add phase
                            </Button>
                        </div>
                        {rolloutDraft.phases.map((phase, index) => (
                            <div
                                className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto]"
                                key={index}
                            >
                                <Field label={`Phase ${index + 1} percentage`}>
                                    <Input
                                        aria-label={`Phase ${index + 1} percentage`}
                                        min={0}
                                        max={100}
                                        type="number"
                                        value={phase.percentage}
                                        onChange={(event) =>
                                            updateDraft({
                                                phases: rolloutDraft.phases.map((current, currentIndex) =>
                                                    currentIndex === index
                                                        ? { ...current, percentage: numberValue(event) }
                                                        : current
                                                ),
                                            })
                                        }
                                    />
                                </Field>
                                <Field label="Minimum minutes">
                                    <Input
                                        aria-label={`Phase ${index + 1} minimum minutes`}
                                        min={0}
                                        type="number"
                                        value={phase.min_duration_minutes}
                                        onChange={(event) =>
                                            updateDraft({
                                                phases: rolloutDraft.phases.map((current, currentIndex) =>
                                                    currentIndex === index
                                                        ? { ...current, min_duration_minutes: numberValue(event) }
                                                        : current
                                                ),
                                            })
                                        }
                                    />
                                </Field>
                                <Button
                                    className="self-end"
                                    variant="quiet"
                                    disabled={rolloutDraft.phases.length === 1}
                                    onClick={() =>
                                        updateDraft({
                                            phases: rolloutDraft.phases.filter(
                                                (_, currentIndex) => currentIndex !== index
                                            ),
                                        })
                                    }
                                >
                                    Remove
                                </Button>
                            </div>
                        ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Guardrail name">
                            <Input
                                aria-label="Guardrail name"
                                value={rolloutDraft.guardrail.name}
                                onChange={(event) =>
                                    updateDraft({
                                        guardrail: { ...rolloutDraft.guardrail, name: event.target.value },
                                    })
                                }
                            />
                        </Field>
                        <Field label="Healthy comparison" hint="The comparison describes healthy values.">
                            <Select
                                aria-label="Healthy comparison"
                                value={rolloutDraft.guardrail.comparison}
                                onChange={(event) =>
                                    updateDraft({
                                        guardrail: {
                                            ...rolloutDraft.guardrail,
                                            comparison: event.target.value as ComparisonEnum,
                                        },
                                    })
                                }
                            >
                                {Object.values(ComparisonEnum).map((comparison) => (
                                    <option key={comparison} value={comparison}>
                                        {comparison}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Threshold">
                            <Input
                                aria-label="Guardrail threshold"
                                step="any"
                                type="number"
                                value={rolloutDraft.guardrail.threshold}
                                onChange={(event) =>
                                    updateDraft({
                                        guardrail: { ...rolloutDraft.guardrail, threshold: numberValue(event) },
                                    })
                                }
                            />
                        </Field>
                        <Field label="Window minutes">
                            <Input
                                aria-label="Guardrail window minutes"
                                min={1}
                                type="number"
                                value={rolloutDraft.guardrail.window_minutes}
                                onChange={(event) =>
                                    updateDraft({
                                        guardrail: { ...rolloutDraft.guardrail, window_minutes: numberValue(event) },
                                    })
                                }
                            />
                        </Field>
                        <Field label="Minimum samples">
                            <Input
                                aria-label="Guardrail minimum samples"
                                min={1}
                                type="number"
                                value={rolloutDraft.guardrail.min_samples}
                                onChange={(event) =>
                                    updateDraft({
                                        guardrail: { ...rolloutDraft.guardrail, min_samples: numberValue(event) },
                                    })
                                }
                            />
                        </Field>
                        <Field label="Maximum hold minutes">
                            <Input
                                aria-label="Guardrail maximum hold minutes"
                                min={1}
                                type="number"
                                value={rolloutDraft.guardrail.max_hold_minutes}
                                onChange={(event) =>
                                    updateDraft({
                                        guardrail: {
                                            ...rolloutDraft.guardrail,
                                            max_hold_minutes: numberValue(event),
                                        },
                                    })
                                }
                            />
                        </Field>
                    </div>

                    {rolloutPlan !== null ? (
                        <div className="rounded-lg bg-slate-50 p-4">
                            <p className="text-sm font-semibold text-slate-900">
                                Current phase <span translate="no">{rolloutPlan.current_phase_index + 1}</span>
                            </p>
                            {rolloutPlan.hold_reason !== '' ? (
                                <p className="mt-1 text-sm text-amber-700">Hold reason: {rolloutPlan.hold_reason}</p>
                            ) : null}
                            <h3 className="mt-4 text-sm font-semibold text-slate-900">Recent samples</h3>
                            {rolloutPlan.recent_samples.length === 0 ? (
                                <p className="mt-1 text-sm text-slate-500">No guardrail samples yet.</p>
                            ) : (
                                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                                    {rolloutPlan.recent_samples.map((sample) => (
                                        <li key={sample.id}>
                                            <span translate="no">{sample.value}</span> from{' '}
                                            <span translate="no">{sample.sample_count}</span> observations
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2">
                        {rolloutPlan !== null ? (
                            <Button
                                variant="danger"
                                disabled={rolloutPlanLoading}
                                onClick={() =>
                                    deleteRolloutPlan({
                                        expected_plan_id: rolloutPlan.id,
                                        expected_version: rolloutPlan.version,
                                    })
                                }
                            >
                                Delete plan
                            </Button>
                        ) : null}
                        <Button disabled={rolloutPlanLoading} onClick={() => saveWithStatus(RolloutStatusEnum.DRAFT)}>
                            Save draft
                        </Button>
                        {rolloutPlan?.status === RolloutStatusEnum.ACTIVE ||
                        rolloutPlan?.status === RolloutStatusEnum.HOLDING ? (
                            <Button
                                disabled={rolloutPlanLoading}
                                onClick={() => saveWithStatus(RolloutStatusEnum.PAUSED)}
                            >
                                Pause
                            </Button>
                        ) : (
                            <Button
                                variant="primary"
                                disabled={rolloutPlanLoading}
                                onClick={() => saveWithStatus(RolloutStatusEnum.ACTIVE)}
                            >
                                Activate
                            </Button>
                        )}
                        {rolloutPlan !== null ? (
                            <Button
                                variant="danger"
                                disabled={rolloutPlanLoading}
                                onClick={() => saveWithStatus(RolloutStatusEnum.REVERTED)}
                            >
                                Revert
                            </Button>
                        ) : null}
                    </div>
                </>
            )}
        </Card>
    )
}
