import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { EnsaioApiClient, EnsaioApiError } from './apiClient.js'
import type { McpConfig } from './config.js'
import { loadRolloutSkill } from './skill.js'
import { executeToolWithTelemetry, getCatalog, getTool, validateToolArguments } from './tools/catalog.js'

function jsonContent(value: unknown): { type: 'text'; text: string }[] {
    return [{ type: 'text', text: JSON.stringify(value) }]
}

function structured(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { result: value }
}

export function createServer(config: McpConfig, fetchFn: typeof fetch = fetch): Server {
    const skill = loadRolloutSkill()
    const apiClient = new EnsaioApiClient(config, fetchFn)
    const server = new Server(
        { name: 'ensaio-feature-flags', version: '0.1.0' },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
            instructions:
                'Load ensaio://skills/managing-health-gated-rollouts before staged or health-gated rollout work.',
        }
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: getCatalog().tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: {
                readOnlyHint: tool.annotations.readOnly,
                destructiveHint: tool.annotations.destructive,
                idempotentHint: tool.annotations.idempotent,
                openWorldHint: false,
            },
        })),
    }))

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = getTool(request.params.name)
        if (!tool) {
            return { isError: true, content: jsonContent({ error: 'unknown_tool' }) }
        }
        try {
            const args = validateToolArguments(tool.name, request.params.arguments ?? {})
            const result = await executeToolWithTelemetry(tool, args, config, apiClient)
            return {
                content: jsonContent(result.value),
                structuredContent: structured(result.value),
                _meta: {
                    ensaio: {
                        duration_ms: result.telemetry.duration_ms,
                        retry_count: result.telemetry.retry_count,
                    },
                },
            }
        } catch (error) {
            if (error instanceof EnsaioApiError) {
                const controlled = {
                    error: error.kind,
                    status: error.status,
                    code: error.code,
                    details: error.details,
                }
                return {
                    isError: true,
                    content: jsonContent(controlled),
                    structuredContent: controlled,
                    ...(error.telemetry
                        ? {
                              _meta: {
                                  ensaio: {
                                      duration_ms: error.telemetry.duration_ms,
                                      retry_count: error.telemetry.retry_count,
                                  },
                              },
                          }
                        : {}),
                }
            }
            const message = error instanceof Error ? error.message : 'Unknown tool execution failure.'
            return {
                isError: true,
                content: jsonContent({ error: 'invalid_tool_call', detail: message }),
            }
        }
    })

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
            {
                uri: skill.uri,
                name: skill.name,
                title: 'Managing health-gated rollouts',
                description: skill.description,
                mimeType: 'text/markdown',
            },
        ],
    }))

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        if (request.params.uri !== skill.uri) {
            throw new Error('Unknown resource URI.')
        }
        return {
            contents: [
                {
                    uri: skill.uri,
                    mimeType: 'text/markdown',
                    text: skill.content,
                },
            ],
        }
    })

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: [
            {
                name: skill.name,
                title: 'Manage a health-gated rollout',
                description: skill.description,
                arguments: [
                    {
                        name: 'intent',
                        description: 'The user request to complete.',
                        required: true,
                    },
                ],
            },
        ],
    }))

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        if (request.params.name !== skill.name) {
            throw new Error('Unknown prompt name.')
        }
        const intent = request.params.arguments?.intent
        if (!intent) throw new Error('The intent prompt argument is required.')
        return {
            description: skill.description,
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: [`Workflow source: ${skill.uri}`, skill.content, `User request:\n${intent}`].join('\n\n'),
                    },
                },
            ],
        }
    })

    return server
}

export async function runStdioServer(config: McpConfig): Promise<void> {
    const server = createServer(config)
    await server.connect(new StdioServerTransport())
}
