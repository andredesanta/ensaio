import type { ChangeEvent, ReactElement } from 'react'

import { Button, Card, Field, Input } from '../../../../frontend/src/lib/ui'
import { newVariant } from '../flagForm'
import type { FiltersRequestPayloads, VariantRequest } from '../generated/models'

type VariantEditorProps = {
    variants: VariantRequest[]
    payloads: FiltersRequestPayloads
    error?: string
    onChange: (variants: VariantRequest[], payloads: FiltersRequestPayloads) => void
}

function displayPayload(payload: unknown): string {
    if (payload === null || payload === undefined) {
        return ''
    }
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
}

function parsePayload(payload: string): unknown {
    try {
        return JSON.parse(payload) as unknown
    } catch {
        return payload
    }
}

export function VariantEditor({ variants, payloads, error, onChange }: VariantEditorProps): ReactElement {
    const replaceVariant = (index: number, variant: VariantRequest): void => {
        const previousKey = variants[index]?.key
        const nextPayloads = { ...payloads }
        if (previousKey !== undefined && previousKey !== variant.key && previousKey in nextPayloads) {
            nextPayloads[variant.key] = nextPayloads[previousKey]
            delete nextPayloads[previousKey]
        }
        onChange(
            variants.map((current, currentIndex) => (currentIndex === index ? variant : current)),
            nextPayloads
        )
    }

    const removeVariant = (index: number): void => {
        const removedKey = variants[index]?.key
        const nextPayloads = { ...payloads }
        if (removedKey !== undefined) {
            delete nextPayloads[removedKey]
        }
        onChange(
            variants.filter((_, currentIndex) => currentIndex !== index),
            nextPayloads
        )
    }

    return (
        <Card title="Variants">
            <p className="mb-4 text-sm text-slate-600">
                Weights split the matched rollout. They must add up to exactly 100.
            </p>
            <div className="space-y-3">
                {variants.map((variant, index) => (
                    <div
                        className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_10rem_1fr_auto]"
                        key={index}
                    >
                        <Field label="Variant key">
                            <Input
                                aria-label={`Variant ${index + 1} key`}
                                value={variant.key}
                                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    replaceVariant(index, { ...variant, key: event.target.value })
                                }
                            />
                        </Field>
                        <Field label="Weight">
                            <Input
                                aria-label={`Variant ${index + 1} weight`}
                                type="number"
                                min={0}
                                max={100}
                                value={variant.rollout_percentage}
                                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    replaceVariant(index, {
                                        ...variant,
                                        rollout_percentage: Number(event.target.value),
                                    })
                                }
                            />
                        </Field>
                        <Field label="Payload" hint="Optional string payload returned with this variant.">
                            <Input
                                aria-label={`Variant ${index + 1} payload`}
                                value={displayPayload(payloads[variant.key])}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                    const nextPayloads = { ...payloads }
                                    if (event.target.value === '') {
                                        delete nextPayloads[variant.key]
                                    } else {
                                        nextPayloads[variant.key] = parsePayload(event.target.value)
                                    }
                                    onChange(variants, nextPayloads)
                                }}
                            />
                        </Field>
                        <Button
                            className="self-end"
                            variant="quiet"
                            aria-label={`Remove variant ${index + 1}`}
                            onClick={() => removeVariant(index)}
                        >
                            Remove
                        </Button>
                    </div>
                ))}
            </div>
            {error !== undefined ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
            <Button
                className="mt-4"
                onClick={() =>
                    onChange([...variants, newVariant(`variant_${variants.length + 1}`, 0)], { ...payloads })
                }
            >
                Add variant
            </Button>
        </Card>
    )
}
