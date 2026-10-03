import type {
    ConditionRequest,
    FeatureFlag,
    FeatureFlagRequest,
    PropertyFilterRequest,
    VariantRequest,
} from './generated/models'
import { OperatorEnum, TypeEnum } from './generated/models'

export const PROPERTY_OPERATORS = Object.values(OperatorEnum)

export function newPropertyFilter(): PropertyFilterRequest {
    return {
        key: '',
        type: TypeEnum.person,
        operator: OperatorEnum.exact,
        value: '',
    }
}

export function newCondition(): ConditionRequest {
    return {
        properties: [],
        rollout_percentage: 100,
        variant: null,
    }
}

export function newVariant(key: string, rolloutPercentage: number): VariantRequest {
    return { key, rollout_percentage: rolloutPercentage }
}

export function newFeatureFlag(): FeatureFlagRequest {
    return {
        key: '',
        name: '',
        active: true,
        filters: {
            groups: [newCondition()],
            multivariate: {
                variants: [newVariant('control', 50), newVariant('test', 50)],
            },
            payloads: {},
        },
    }
}

export function featureFlagToRequest(flag: FeatureFlag): FeatureFlagRequest {
    return {
        key: flag.key,
        name: flag.name ?? '',
        active: flag.active ?? true,
        filters:
            flag.filters === undefined
                ? { groups: [] }
                : {
                      groups: flag.filters.groups.map((condition) => ({
                          ...condition,
                          properties: condition.properties.map((property) => ({ ...property })),
                      })),
                      multivariate:
                          flag.filters.multivariate == null
                              ? flag.filters.multivariate
                              : {
                                    variants: flag.filters.multivariate.variants.map((variant) => ({ ...variant })),
                                },
                      payloads: { ...flag.filters.payloads },
                  },
    }
}

export function flagFormErrors(flag: FeatureFlagRequest): Record<string, string | undefined> {
    const variants = flag.filters?.multivariate?.variants ?? []
    const variantKeys = variants.map((variant) => variant.key)
    const totalWeight = variants.reduce((sum, variant) => sum + variant.rollout_percentage, 0)

    return {
        key:
            flag.key.trim() === ''
                ? 'Enter a key.'
                : /^[-a-zA-Z0-9_]+$/.test(flag.key)
                  ? undefined
                  : 'Use letters, numbers, hyphens, and underscores only.',
        filters:
            flag.filters === undefined || flag.filters.groups.length === 0 ? 'Add at least one condition.' : undefined,
        variants:
            variants.length === 0
                ? 'Add at least one variant.'
                : new Set(variantKeys).size !== variantKeys.length
                  ? 'Variant keys must be unique.'
                  : Math.abs(totalWeight - 100) > Number.EPSILON
                    ? 'Variant weights must sum to 100.'
                    : undefined,
    }
}
