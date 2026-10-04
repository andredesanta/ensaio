import { Ajv, type ValidateFunction } from 'ajv/dist/ajv.js'

import { EnsaioApiClient, EnsaioApiError, type ToolCallLog } from '../apiClient.js'
import type { McpConfig } from '../config.js'
import { generatedCatalog } from './generated.js'
import type { GeneratedTool, ToolCatalog } from './types.js'

const catalog = generatedCatalog as unknown as ToolCatalog
const toolsByName = new Map(catalog.tools.map((tool) => [tool.name, tool]))
const ajv = new Ajv({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
    validateFormats: false,
})
const validators = new Map<string, ValidateFunction>(
    catalog.tools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)])
)
const outputValidators = new Map<string, ValidateFunction>(
    catalog.tools.map((tool) => [tool.name, ajv.compile(tool.outputSchema)])
)

export function getCatalog(): ToolCatalog {
    return catalog
}

export function getTool(name: string): GeneratedTool | undefined {
    return toolsByName.get(name)
}

export function validateToolArguments(name: string, args: unknown): Record<string, unknown> {
    const validator = validators.get(name)
    if (!validator) throw new Error(`Unknown tool ${name}.`)
    if (!validator(args)) {
        throw new Error(`Invalid tool arguments: ${ajv.errorsText(validator.errors, { separator: '; ' })}`)
    }
    return args as Record<string, unknown>
}

export function validateToolResult(name: string, result: unknown): unknown {
    const validator = outputValidators.get(name)
    if (!validator) throw new Error(`Unknown tool ${name}.`)
    if (!validator(result)) {
        throw new Error(`Invalid tool result: ${ajv.errorsText(validator.errors, { separator: '; ' })}`)
    }
    return result
}

function project(value: unknown, fields: string[]): unknown {
    if (Array.isArray(value)) return value.map((item) => project(item, fields))
    if (typeof value !== 'object' || value === null) return value
    const record = value as Record<string, unknown>
    return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]))
}

function buildPath(tool: GeneratedTool, config: McpConfig, args: Record<string, unknown>): string {
    let value = tool.path.replace('{team_id}', String(config.projectId))
    for (const name of tool.pathParameters) {
        value = value.replace(`{${name}}`, encodeURIComponent(String(args[name])))
    }
    return value
}

export type ExecutedTool = {
    value: unknown
    telemetry: ToolCallLog
}

export async function executeToolWithTelemetry(
    tool: GeneratedTool,
    args: Record<string, unknown>,
    config: McpConfig,
    client: EnsaioApiClient
): Promise<ExecutedTool> {
    const path = buildPath(tool, config, args)
    const query = Object.fromEntries(tool.queryParameters.map((name) => [name, args[name]]))
    const body =
        tool.bodyParameters.length === 0
            ? undefined
            : Object.fromEntries(
                  tool.bodyParameters.filter((name) => args[name] !== undefined).map((name) => [name, args[name]])
              )
    try {
        const result = await client.request({
            toolName: tool.name,
            readOnly: tool.annotations.readOnly,
            method: tool.method,
            path,
            query,
            ...(body === undefined ? {} : { body }),
        })
        const projected = project(result.data, tool.responseProjection)
        const projectedOutput = Array.isArray(projected) ? { items: projected } : projected
        if (tool.expectedAbsence) {
            return {
                value: validateToolResult(tool.name, {
                    exists: true,
                    [tool.expectedAbsence.valueField]: projectedOutput,
                }),
                telemetry: result.telemetry,
            }
        }
        return {
            value: validateToolResult(tool.name, projectedOutput),
            telemetry: result.telemetry,
        }
    } catch (error) {
        if (
            error instanceof EnsaioApiError &&
            tool.expectedAbsence &&
            error.status === 404 &&
            error.code === tool.expectedAbsence.errorCode
        ) {
            if (!error.telemetry) throw error
            return {
                value: validateToolResult(tool.name, {
                    exists: false,
                    ...Object.fromEntries(tool.expectedAbsence.echoParams.map((name) => [name, args[name]])),
                }),
                telemetry: error.telemetry,
            }
        }
        throw error
    }
}

export async function executeTool(
    tool: GeneratedTool,
    args: Record<string, unknown>,
    config: McpConfig,
    client: EnsaioApiClient
): Promise<unknown> {
    return (await executeToolWithTelemetry(tool, args, config, client)).value
}
