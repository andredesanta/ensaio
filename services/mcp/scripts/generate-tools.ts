import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import type { GeneratedTool, JsonSchema, ToolCatalog } from '../src/tools/types.js'

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(MCP_ROOT, '../..')
const OPENAPI_PATH = path.join(REPO_ROOT, 'frontend/openapi.json')
const MANIFEST_PATH = path.join(REPO_ROOT, 'products/feature_flags/mcp/tools.yaml')
const GENERATED_PATH = path.join(MCP_ROOT, 'src/tools/generated.ts')
const CATALOG_PATH = path.join(MCP_ROOT, 'schema/tool-catalog.json')

const annotationsSchema = z
    .object({
        readOnly: z.boolean(),
        destructive: z.boolean(),
        idempotent: z.boolean(),
    })
    .strict()

const enabledToolSchema = z
    .object({
        operation: z.string().min(1),
        enabled: z.literal(true),
        scopes: z.array(z.enum(['feature_flag:read', 'feature_flag:write'])).min(1),
        annotations: annotationsSchema,
        title: z.string().min(1).max(80),
        description: z.string().min(20),
        parameters: z.array(z.string()).refine((items) => new Set(items).size === items.length, 'Duplicate parameter.'),
        response: z
            .object({
                include: z.array(z.string()).min(1),
            })
            .strict(),
        expected_absence: z
            .object({
                error_code: z.string().min(1),
                value_field: z.string().min(1),
                echo_params: z.array(z.string()),
            })
            .strict()
            .optional(),
    })
    .strict()

const disabledToolSchema = z
    .object({
        operation: z.string().min(1),
        enabled: z.literal(false),
    })
    .strict()

const manifestSchema = z
    .object({
        version: z.literal(1),
        tools: z.record(z.string(), z.union([enabledToolSchema, disabledToolSchema])),
    })
    .strict()

type OpenApiOperation = {
    operationId?: string
    parameters?: Array<{
        name: string
        in: 'path' | 'query' | 'header' | 'cookie'
        required?: boolean
        description?: string
        schema: JsonSchema & { $ref?: string }
    }>
    requestBody?: {
        content?: {
            'application/json'?: {
                schema: JsonSchema & { $ref?: string }
            }
        }
    }
    responses?: Record<
        string,
        {
            content?: {
                'application/json'?: {
                    schema: JsonSchema & { $ref?: string }
                }
            }
        }
    >
    'x-product'?: string
}

type OpenApi = {
    paths: Record<string, Record<string, OpenApiOperation>>
    components?: {
        schemas?: Record<string, JsonSchema & { $ref?: string }>
    }
}

type ResolvedOperation = {
    method: string
    path: string
    operation: OpenApiOperation
}

function invariant(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
}

function readJson<T>(filename: string): T {
    return JSON.parse(fs.readFileSync(filename, 'utf8')) as T
}

function normalizeNullable(schema: JsonSchema): JsonSchema {
    const { nullable: _nullable, 'x-spec-enum-id': _enumId, ...rest } = schema
    if (rest.enum?.includes(null) && typeof rest.type === 'string') {
        return { ...rest, type: [rest.type, 'null'] }
    }
    if (!schema.nullable) return rest
    const alreadyAllowsNull =
        rest.type === 'null' ||
        (Array.isArray(rest.type) && rest.type.includes('null')) ||
        rest.enum?.includes(null) ||
        rest.oneOf?.some((member) => member.type === 'null' || member.enum?.includes(null)) ||
        rest.anyOf?.some((member) => member.type === 'null' || member.enum?.includes(null))
    if (alreadyAllowsNull) return rest
    if (typeof rest.type === 'string') return { ...rest, type: [rest.type, 'null'] }
    if (rest.oneOf) return { ...rest, oneOf: [...rest.oneOf, { type: 'null' }] }
    if (rest.anyOf) return { ...rest, anyOf: [...rest.anyOf, { type: 'null' }] }
    return rest
}

function resolveSchema(spec: OpenApi, input: (JsonSchema & { $ref?: string }) | undefined): JsonSchema {
    invariant(input, 'OpenAPI operation is missing a JSON schema.')
    if (input.$ref) {
        const name = input.$ref.replace('#/components/schemas/', '')
        const component = spec.components?.schemas?.[name]
        invariant(component, `OpenAPI schema reference ${input.$ref} does not exist.`)
        return resolveSchema(spec, component)
    }
    if (input.allOf) {
        const members = input.allOf.map((item) => resolveSchema(spec, item))
        const { allOf: _allOf, ...rest } = input
        if (members.length === 1 && !members[0]?.properties) {
            return normalizeNullable({ ...members[0], ...rest })
        }
        const properties = Object.assign({}, ...members.map((item) => item.properties ?? {}))
        const required = [...new Set(members.flatMap((item) => item.required ?? []))]
        return normalizeNullable({ ...rest, type: rest.type ?? 'object', properties, required })
    }
    return normalizeNullable({
        ...input,
        ...(input.properties
            ? {
                  properties: Object.fromEntries(
                      Object.entries(input.properties).map(([name, schema]) => [name, resolveSchema(spec, schema)])
                  ),
              }
            : {}),
        ...(input.items ? { items: resolveSchema(spec, input.items) } : {}),
        ...(typeof input.additionalProperties === 'object'
            ? { additionalProperties: resolveSchema(spec, input.additionalProperties) }
            : {}),
        ...(input.oneOf ? { oneOf: input.oneOf.map((schema) => resolveSchema(spec, schema)) } : {}),
        ...(input.anyOf ? { anyOf: input.anyOf.map((schema) => resolveSchema(spec, schema)) } : {}),
    })
}

function operationIndex(spec: OpenApi): Map<string, ResolvedOperation> {
    const index = new Map<string, ResolvedOperation>()
    for (const [urlPath, pathItem] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
            if (!operation.operationId) continue
            invariant(!index.has(operation.operationId), `Duplicate OpenAPI operation ID ${operation.operationId}.`)
            index.set(operation.operationId, {
                method: method.toUpperCase(),
                path: urlPath,
                operation,
            })
        }
    }
    return index
}

function successSchema(spec: OpenApi, operation: OpenApiOperation): JsonSchema {
    const response = Object.entries(operation.responses ?? {})
        .filter(([status]) => /^2\d\d$/.test(status))
        .sort(([left], [right]) => left.localeCompare(right))[0]?.[1]
    invariant(response, `Operation ${operation.operationId} has no success response.`)
    return resolveSchema(spec, response.content?.['application/json']?.schema)
}

function responseSchema(spec: OpenApi, operation: OpenApiOperation, status: string): JsonSchema {
    const response = operation.responses?.[status]
    invariant(response, `Operation ${operation.operationId} has no ${status} response.`)
    return resolveSchema(spec, response.content?.['application/json']?.schema)
}

function propertyEnum(schema: JsonSchema, property: string): unknown[] {
    const direct = schema.properties?.[property]?.enum ?? []
    return [
        ...direct,
        ...(schema.oneOf ?? []).flatMap((member) => propertyEnum(member, property)),
        ...(schema.anyOf ?? []).flatMap((member) => propertyEnum(member, property)),
        ...(schema.allOf ?? []).flatMap((member) => propertyEnum(member, property)),
    ]
}

function projectSchema(schema: JsonSchema, fields: string[], operation: string): JsonSchema {
    if (schema.type === 'array') {
        invariant(schema.items, `Operation ${operation} has an array response without item schema.`)
        return { type: 'array', items: projectSchema(schema.items, fields, operation) }
    }
    invariant(schema.properties, `Operation ${operation} response is not an object.`)
    for (const field of fields) {
        invariant(field in schema.properties, `Response field ${field} does not exist on ${operation}.`)
    }
    return {
        type: 'object',
        properties: Object.fromEntries(fields.map((field) => [field, schema.properties?.[field] ?? {}])),
        required: fields.filter((field) => schema.required?.includes(field)),
        additionalProperties: false,
    }
}

function expectedAbsenceSchema(
    projected: JsonSchema,
    valueField: string,
    echoParams: string[],
    inputProperties: Record<string, JsonSchema>
): JsonSchema {
    return {
        type: 'object',
        oneOf: [
            {
                type: 'object',
                properties: {
                    exists: { type: 'boolean', enum: [true] },
                    [valueField]: projected,
                },
                required: ['exists', valueField],
                additionalProperties: false,
            },
            {
                type: 'object',
                properties: {
                    exists: { type: 'boolean', enum: [false] },
                    ...Object.fromEntries(echoParams.map((name) => [name, inputProperties[name] ?? {}])),
                },
                required: ['exists', ...echoParams],
                additionalProperties: false,
            },
        ],
    }
}

function mcpOutputSchema(projected: JsonSchema): JsonSchema {
    if (projected.type !== 'array') return projected
    return {
        type: 'object',
        properties: {
            items: projected,
        },
        required: ['items'],
        additionalProperties: false,
    }
}

function buildTool(
    spec: OpenApi,
    name: string,
    config: z.infer<typeof enabledToolSchema>,
    resolved: ResolvedOperation
): GeneratedTool {
    invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64, `Invalid tool name ${name}.`)
    invariant(
        config.annotations.readOnly
            ? config.scopes.every((scope) => scope === 'feature_flag:read')
            : config.scopes.includes('feature_flag:write'),
        `Scopes do not match safety annotations for ${name}.`
    )

    const sourceParameters = new Map<
        string,
        { location: 'path' | 'query' | 'body'; schema: JsonSchema; required: boolean }
    >()
    for (const parameter of resolved.operation.parameters ?? []) {
        if (parameter.name === 'team_id') continue
        invariant(
            parameter.in === 'path' || parameter.in === 'query',
            `Tool ${name} may not expose ${parameter.in} parameter ${parameter.name}.`
        )
        sourceParameters.set(parameter.name, {
            location: parameter.in,
            schema: {
                ...resolveSchema(spec, parameter.schema),
                ...(parameter.description ? { description: parameter.description } : {}),
            },
            required: Boolean(parameter.required),
        })
    }
    const requestSchema = resolved.operation.requestBody?.content?.['application/json']?.schema
    if (requestSchema) {
        const body = resolveSchema(spec, requestSchema)
        for (const [parameterName, schema] of Object.entries(body.properties ?? {})) {
            sourceParameters.set(parameterName, {
                location: 'body',
                schema,
                required: Boolean(body.required?.includes(parameterName)) || parameterName.startsWith('expected_'),
            })
        }
    }

    for (const parameter of config.parameters) {
        invariant(sourceParameters.has(parameter), `Tool ${name} allowlists unknown parameter ${parameter}.`)
        invariant(parameter !== 'team_id' && parameter !== 'Authorization', `Tool ${name} exposes protected context.`)
    }
    for (const [parameter, source] of sourceParameters) {
        invariant(
            !source.required || config.parameters.includes(parameter),
            `Tool ${name} omits required ${source.location} parameter ${parameter}.`
        )
    }

    const selected = config.parameters.map((parameter) => {
        const source = sourceParameters.get(parameter)
        invariant(source, `Missing parameter ${parameter}.`)
        return [parameter, source] as const
    })
    const inputProperties = Object.fromEntries(selected.map(([parameter, source]) => [parameter, source.schema]))
    const required = selected.filter(([, source]) => source.required).map(([parameter]) => parameter)
    const inputSchema: JsonSchema = {
        type: 'object',
        properties: inputProperties,
        required,
        additionalProperties: false,
    }
    const projected = projectSchema(successSchema(spec, resolved.operation), config.response.include, config.operation)
    const projectedOutput = mcpOutputSchema(projected)

    let outputSchema = projectedOutput
    let expectedAbsence: GeneratedTool['expectedAbsence']
    if (config.expected_absence) {
        invariant(config.annotations.readOnly, `Expected absence is read-only for ${name}.`)
        invariant(
            '404' in (resolved.operation.responses ?? {}),
            `Expected absence requires a documented 404 for ${name}.`
        )
        invariant(
            propertyEnum(responseSchema(spec, resolved.operation, '404'), 'code').includes(
                config.expected_absence.error_code
            ),
            `Expected absence code ${config.expected_absence.error_code} is not documented by ${config.operation}.`
        )
        for (const parameter of config.expected_absence.echo_params) {
            invariant(
                config.parameters.includes(parameter),
                `Expected absence echo ${parameter} is not allowlisted for ${name}.`
            )
        }
        expectedAbsence = {
            errorCode: config.expected_absence.error_code,
            valueField: config.expected_absence.value_field,
            echoParams: config.expected_absence.echo_params,
        }
        outputSchema = expectedAbsenceSchema(
            projectedOutput,
            expectedAbsence.valueField,
            expectedAbsence.echoParams,
            inputProperties
        )
    }

    return {
        name,
        operation: config.operation,
        title: config.title,
        description: config.description,
        scopes: config.scopes,
        annotations: config.annotations,
        method: resolved.method,
        path: resolved.path,
        inputSchema,
        pathParameters: selected.filter(([, source]) => source.location === 'path').map(([parameter]) => parameter),
        queryParameters: selected.filter(([, source]) => source.location === 'query').map(([parameter]) => parameter),
        bodyParameters: selected.filter(([, source]) => source.location === 'body').map(([parameter]) => parameter),
        responseProjection: config.response.include,
        outputSchema,
        ...(expectedAbsence ? { expectedAbsence } : {}),
    }
}

export function generateArtifacts(): { generated: string; catalog: string } {
    const spec = readJson<OpenApi>(OPENAPI_PATH)
    const parsedManifest = manifestSchema.parse(parseYaml(fs.readFileSync(MANIFEST_PATH, 'utf8')))
    const index = operationIndex(spec)
    const productOperations = new Set(
        [...index.entries()]
            .filter(([, resolved]) => resolved.operation['x-product'] === 'feature_flags')
            .map(([operation]) => operation)
    )
    const configuredOperations = new Set(Object.values(parsedManifest.tools).map((tool) => tool.operation))
    for (const operation of productOperations) {
        invariant(
            configuredOperations.has(operation),
            `Feature-flags operation ${operation} is absent from tools.yaml.`
        )
    }
    for (const operation of configuredOperations) {
        invariant(
            productOperations.has(operation),
            `Manifest operation ${operation} is missing or not feature_flags-owned.`
        )
    }

    const tools = Object.entries(parsedManifest.tools)
        .filter((entry): entry is [string, z.infer<typeof enabledToolSchema>] => entry[1].enabled)
        .map(([name, config]) => {
            const resolved = index.get(config.operation)
            invariant(resolved, `Operation ${config.operation} does not exist.`)
            return buildTool(spec, name, config, resolved)
        })
        .sort((left, right) => left.name.localeCompare(right.name))

    invariant(new Set(tools.map((tool) => tool.name)).size === tools.length, 'Tool names must be unique.')
    const catalog: ToolCatalog = {
        version: 1,
        generatedFrom: {
            openapi: 'frontend/openapi.json',
            manifest: 'products/feature_flags/mcp/tools.yaml',
        },
        tools,
    }
    const catalogJson = `${JSON.stringify(catalog, null, 4)}\n`
    const generated = [
        '// Generated by scripts/generate-tools.ts. Do not edit manually.',
        "import type { ToolCatalog } from './types.js'",
        '',
        `export const generatedCatalog = ${JSON.stringify(catalog, null, 4)} as const satisfies ToolCatalog`,
        '',
    ].join('\n')
    return { generated, catalog: catalogJson }
}

function writeOrCheck(filename: string, content: string, check: boolean): void {
    if (check) {
        invariant(fs.existsSync(filename), `Generated file ${path.relative(REPO_ROOT, filename)} is missing.`)
        invariant(
            fs.readFileSync(filename, 'utf8') === content,
            `Generated file ${path.relative(REPO_ROOT, filename)} is stale.`
        )
        return
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, content)
}

export function runGeneration(check: boolean): void {
    const { generated, catalog } = generateArtifacts()
    writeOrCheck(GENERATED_PATH, generated, check)
    writeOrCheck(CATALOG_PATH, catalog, check)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runGeneration(process.argv.includes('--check'))
}
