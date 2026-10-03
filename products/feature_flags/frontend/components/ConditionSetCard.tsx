import type { ChangeEvent, ReactElement } from 'react'

import { Button, Card, Field, Input, Select } from '../../../../frontend/src/lib/ui'
import { PROPERTY_OPERATORS, newPropertyFilter } from '../flagForm'
import type { ConditionRequest, OperatorEnum, PropertyFilterRequest } from '../generated/models'

type ConditionSetCardProps = {
    index: number
    condition: ConditionRequest
    onChange: (condition: ConditionRequest) => void
    onRemove: () => void
    canRemove: boolean
}

function displayValue(value: unknown): string {
    if (value === null || value === undefined) {
        return ''
    }
    return typeof value === 'string' ? value : JSON.stringify(value)
}

function parseValue(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return value
    }
}

export function ConditionSetCard({
    index,
    condition,
    onChange,
    onRemove,
    canRemove,
}: ConditionSetCardProps): ReactElement {
    const replaceProperty = (propertyIndex: number, property: PropertyFilterRequest): void => {
        onChange({
            ...condition,
            properties: condition.properties.map((current, currentIndex) =>
                currentIndex === propertyIndex ? property : current
            ),
        })
    }

    const removeProperty = (propertyIndex: number): void => {
        onChange({
            ...condition,
            properties: condition.properties.filter((_, currentIndex) => currentIndex !== propertyIndex),
        })
    }

    return (
        <Card
            title={`Condition ${index + 1}`}
            actions={
                <Button variant="danger" onClick={onRemove} disabled={!canRemove}>
                    Remove condition
                </Button>
            }
        >
            <div className="space-y-4">
                <Field label="Rollout percentage" hint="Eligible people enter this condition's rollout bucket.">
                    <Input
                        aria-label={`Condition ${index + 1} rollout percentage`}
                        type="number"
                        min={0}
                        max={100}
                        value={condition.rollout_percentage ?? 100}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            onChange({ ...condition, rollout_percentage: Number(event.target.value) })
                        }
                    />
                </Field>

                <div className="space-y-3">
                    {condition.properties.map((property, propertyIndex) => (
                        <div
                            className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_12rem_1fr_auto]"
                            key={propertyIndex}
                        >
                            <Field label="Property key">
                                <Input
                                    aria-label={`Condition ${index + 1} property ${propertyIndex + 1} key`}
                                    value={property.key}
                                    placeholder="country"
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                        replaceProperty(propertyIndex, { ...property, key: event.target.value })
                                    }
                                />
                            </Field>
                            <Field label="Operator">
                                <Select
                                    aria-label={`Condition ${index + 1} property ${propertyIndex + 1} operator`}
                                    value={property.operator}
                                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                                        replaceProperty(propertyIndex, {
                                            ...property,
                                            operator: event.target.value as OperatorEnum,
                                        })
                                    }
                                >
                                    {PROPERTY_OPERATORS.map((operator) => (
                                        <option value={operator} key={operator}>
                                            {operator}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label="Expected value">
                                <Input
                                    aria-label={`Condition ${index + 1} property ${propertyIndex + 1} value`}
                                    value={displayValue(property.value)}
                                    placeholder="BR"
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                        replaceProperty(propertyIndex, {
                                            ...property,
                                            value: parseValue(event.target.value),
                                        })
                                    }
                                />
                            </Field>
                            <Button
                                className="self-end"
                                variant="quiet"
                                aria-label={`Remove property ${propertyIndex + 1} from condition ${index + 1}`}
                                onClick={() => removeProperty(propertyIndex)}
                            >
                                Remove
                            </Button>
                        </div>
                    ))}
                </div>

                <Button
                    onClick={() =>
                        onChange({ ...condition, properties: [...condition.properties, newPropertyFilter()] })
                    }
                >
                    Add property
                </Button>
            </div>
        </Card>
    )
}
