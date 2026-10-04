export type JsonSchema = {
    type?: string | string[]
    properties?: Record<string, JsonSchema>
    required?: string[]
    items?: JsonSchema
    enum?: unknown[]
    oneOf?: JsonSchema[]
    anyOf?: JsonSchema[]
    allOf?: JsonSchema[]
    additionalProperties?: boolean | JsonSchema
    nullable?: boolean
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    format?: string
    description?: string
    default?: unknown
    $ref?: string
    readOnly?: boolean
    writeOnly?: boolean
    'x-spec-enum-id'?: string
}

export type SafetyAnnotations = {
    readOnly: boolean
    destructive: boolean
    idempotent: boolean
}

export type ExpectedAbsence = {
    errorCode: string
    valueField: string
    echoParams: string[]
}

export type GeneratedTool = {
    name: string
    operation: string
    title: string
    description: string
    scopes: string[]
    annotations: SafetyAnnotations
    method: string
    path: string
    inputSchema: JsonSchema
    pathParameters: string[]
    queryParameters: string[]
    bodyParameters: string[]
    responseProjection: string[]
    outputSchema: JsonSchema
    expectedAbsence?: ExpectedAbsence
}

export type ToolCatalog = {
    version: 1
    generatedFrom: {
        openapi: string
        manifest: string
    }
    tools: GeneratedTool[]
}
