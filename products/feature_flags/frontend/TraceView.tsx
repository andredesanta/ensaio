import { useActions, useValues } from 'kea'
import { router } from 'kea-router'
import type { ChangeEvent, FormEvent, ReactElement } from 'react'

import { Button, Card, ErrorBanner, Field, Input, Tag, TextArea } from '../../../frontend/src/lib/ui'
import { urls } from '../manifest'
import type { TraceStep } from './generated/models'
import { traceLogic } from './traceLogic'

type TraceViewProps = {
    teamId: number
    flagId: number
}

function display(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    return JSON.stringify(value) ?? '—'
}

function traceStepSummary(step: TraceStep): string {
    switch (step.step) {
        case 'flag_active':
            return step.result === true ? 'The flag is active.' : 'The flag is inactive.'
        case 'property':
            return `${step.key ?? 'Property'} ${step.operator ?? 'matched'} ${display(step.expected)} — ${
                step.result === true ? 'passed' : 'failed'
            } (actual: ${display(step.actual)})`
        case 'condition':
            return `Condition ${(step.index ?? step.condition_index ?? 0) + 1} ${
                (step.filters_pass ?? step.result) === true ? 'matched' : 'did not match'
            }.`
        case 'rollout_hash':
            return `Rollout hash ${step.value ?? '—'} against threshold ${step.threshold ?? '—'}: ${
                step.in_rollout === true ? 'included' : 'excluded'
            }.`
        case 'variant_override':
            return `Condition selected variant ${step.variant ?? '—'}.`
        case 'variant_hash':
            return `Variant hash selected ${step.variant ?? '—'}.`
    }
    return 'Unknown evaluation step.'
}

export function TraceView({ teamId, flagId }: TraceViewProps): ReactElement {
    const logic = traceLogic({ teamId, flagId })
    const { distinctId, propertiesText, inputError, traceResult, traceResultLoading, traceError } = useValues(logic)
    const { setDistinctId, setPropertiesText, submitTrace } = useActions(logic)

    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        submitTrace()
    }

    return (
        <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
            <div className="mx-auto max-w-4xl space-y-6">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <button
                            className="mb-2 text-sm font-medium text-fuchsia-700 hover:underline"
                            type="button"
                            onClick={() => router.actions.push(urls.featureFlag(flagId))}
                        >
                            ← Edit flag
                        </button>
                        <h1 className="text-3xl font-bold">Decision trace</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Reproduce an evaluation and see why flag #{flagId} returned its answer.
                        </p>
                    </div>
                    <Button onClick={() => router.actions.push(urls.featureFlags())}>All flags</Button>
                </header>

                <Card title="Evaluation input">
                    <form className="space-y-4" onSubmit={submit}>
                        <Field label="Distinct ID" hint="The stable identifier used for deterministic rollout hashing.">
                            <Input
                                aria-label="Distinct ID"
                                value={distinctId}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setDistinctId(event.target.value)}
                            />
                        </Field>
                        <Field label="Properties JSON" error={inputError ?? undefined}>
                            <TextArea
                                aria-label="Properties JSON"
                                rows={8}
                                value={propertiesText}
                                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                                    setPropertiesText(event.target.value)
                                }
                            />
                        </Field>
                        <Button type="submit" variant="primary" disabled={traceResultLoading}>
                            {traceResultLoading ? 'Evaluating…' : 'Run trace'}
                        </Button>
                    </form>
                </Card>

                {traceError !== null ? <ErrorBanner>{traceError}</ErrorBanner> : null}

                {traceResult !== null ? (
                    <>
                        <Card title="Decision">
                            <div className="grid gap-4 sm:grid-cols-4">
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Enabled</p>
                                    <p className="mt-1 text-lg font-semibold">{traceResult.enabled ? 'Yes' : 'No'}</p>
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Variant</p>
                                    <p className="mt-1 text-lg font-semibold">{traceResult.variant ?? '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Reason</p>
                                    <div className="mt-1">
                                        <Tag>{traceResult.reason}</Tag>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Payload</p>
                                    <p className="mt-1 break-all font-mono text-sm">{display(traceResult.payload)}</p>
                                </div>
                            </div>
                        </Card>

                        <Card title="Ordered evaluation steps">
                            <ol className="space-y-3">
                                {traceResult.trace.map((step, index) => (
                                    <li className="flex gap-3" key={index}>
                                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-sm font-bold text-fuchsia-800">
                                            {index + 1}
                                        </span>
                                        <div>
                                            <p className="font-mono text-xs uppercase tracking-wide text-slate-500">
                                                {step.step}
                                            </p>
                                            <p className="mt-1 text-sm text-slate-800">{traceStepSummary(step)}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </Card>
                    </>
                ) : null}
            </div>
        </main>
    )
}
