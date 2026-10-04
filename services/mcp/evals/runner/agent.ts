import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import OpenAI from 'openai'

import { redactText } from '../../src/apiClient.js'
import { loadConfig } from '../../src/config.js'
import { findRepositoryRoot, loadRolloutSkill, ROLLOUT_SKILL_NAME, ROLLOUT_SKILL_URI } from '../../src/skill.js'
import { getCatalog } from '../../src/tools/catalog.js'
import { loadBenchmark, type BenchmarkTask } from '../benchmark/schema.js'
import { RestSeeder } from './seed.js'

export type SkillDelivery = 'none' | 'resource' | 'prompt' | 'native'

export type TraceEvent = {
    kind: 'tool' | 'resource' | 'prompt' | 'native'
    name: string
    arguments?: Record<string, unknown>
    isError?: boolean
    durationMs?: number
    apiDurationMs?: number
    retryCount?: number
    result?: {
        status: 'ok' | 'error'
        errorCode?: string
        exists?: boolean
    }
}

type ProviderFunctionCall = {
    type: 'function_call'
    name: string
    arguments: string
    call_id: string
}

type McpToolResult = Awaited<ReturnType<Client['callTool']>>

type ProviderResponse = {
    id: string
    output_text: string
    output: Array<{ type: string } | ProviderFunctionCall>
    status?: string
    usage?: {
        input_tokens?: number
        output_tokens?: number
        total_tokens?: number
    }
}

type TrialResult = {
    taskId: string
    repetition: number
    resetSucceeded: boolean
    model: string
    provider: 'openai'
    finishReason: string
    skillDelivery: SkillDelivery
    finalText: string
    trace: TraceEvent[]
    scores: {
        expectedToolCoverage: number
        forbiddenToolAvoidance: boolean
        traceAssertions: boolean
        finalState: boolean
        toolErrors: number
        argumentSchemaValidity: boolean
        retries: number
        toolLatencyMs: {
            p50: number
            p95: number
        }
    } | null
    tokens: {
        input: number | null
        output: number | null
        total: number | null
    }
    error: string | null
}

type TokenCounts = TrialResult['tokens']

const PROVIDER_TIMEOUT_MS = 60_000

function requiredEnvironment(name: string): string {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Agent eval requires ${name}; no run or baseline was written.`)
    return value
}

function stringEnvironment(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
}

function currentGitCommit(repositoryRoot: string): string {
    try {
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        const status = execFileSync('git', ['status', '--porcelain'], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        if (status) throw new Error('dirty')
        return commit
    } catch {
        throw new Error('Agent eval requires a committed, clean Git tree so the baseline is reproducible.')
    }
}

function mcpSdkVersion(repositoryRoot: string): string {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'services/mcp/package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
    }
    const version = packageJson.dependencies?.['@modelcontextprotocol/sdk']
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error('Agent eval requires an exactly pinned MCP SDK dependency.')
    }
    return version
}

function sanitizeTraceValue(value: unknown): unknown {
    if (typeof value === 'string') return value.startsWith('ens_') ? '[REDACTED]' : value
    if (Array.isArray(value)) return value.map((item) => sanitizeTraceValue(item))
    if (typeof value !== 'object' || value === null) return value

    const hidden = new Set(['distinct_id', 'properties', 'person_properties', 'payload', 'payloads'])
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, hidden.has(key) ? '[REDACTED]' : sanitizeTraceValue(item)])
    )
}

export function sanitizeArguments(value: Record<string, unknown>): Record<string, unknown> {
    return sanitizeTraceValue(value) as Record<string, unknown>
}

function addTokenCount(current: number | null, next: number | undefined): number | null {
    return next === undefined ? current : (current ?? 0) + next
}

export function sanitizeEvalError(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
    let message = redactText(error instanceof Error ? error.message : 'Unknown agent trial failure.')
    for (const secret of [env.OPENAI_API_KEY, env.ENSAIO_API_TOKEN]) {
        if (secret) message = message.replaceAll(secret, '[REDACTED]')
    }
    return message
}

function summarizeToolResult(result: McpToolResult): NonNullable<TraceEvent['result']> {
    const value = result as {
        isError?: boolean
        structuredContent?: unknown
        content?: unknown
    }
    const summary: NonNullable<TraceEvent['result']> = {
        status: value.isError ? 'error' : 'ok',
    }
    const structured =
        typeof value.structuredContent === 'object' && value.structuredContent !== null
            ? (value.structuredContent as Record<string, unknown>)
            : undefined
    if (typeof structured?.exists === 'boolean') {
        summary.exists = structured.exists
    }
    if (value.isError && Array.isArray(value.content)) {
        const textItem = value.content.find(
            (item): item is { type: 'text'; text: string } =>
                typeof item === 'object' &&
                item !== null &&
                (item as Record<string, unknown>).type === 'text' &&
                typeof (item as Record<string, unknown>).text === 'string'
        )
        const text = textItem?.text
        if (text) {
            try {
                const body = JSON.parse(text) as { code?: unknown; error?: unknown }
                if (typeof body.code === 'string') {
                    summary.errorCode = body.code
                } else if (typeof body.error === 'string') {
                    summary.errorCode = body.error
                }
            } catch {
                // Provider traces deliberately omit uncontrolled error text.
            }
        }
    }
    return summary
}

function toolTelemetry(result: McpToolResult): { apiDurationMs?: number; retryCount?: number } {
    const metadata = (result as { _meta?: { ensaio?: Record<string, unknown> } })._meta?.ensaio
    return {
        ...(typeof metadata?.duration_ms === 'number' ? { apiDurationMs: metadata.duration_ms } : {}),
        ...(typeof metadata?.retry_count === 'number' ? { retryCount: metadata.retry_count } : {}),
    }
}

function readPath(value: unknown, dottedPath: string): unknown {
    return dottedPath.split('.').reduce<unknown>((current, segment) => {
        if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)]
        if (typeof current === 'object' && current !== null) return (current as Record<string, unknown>)[segment]
        return undefined
    }, value)
}

function mutationTools(): Set<string> {
    return new Set(
        getCatalog()
            .tools.filter((tool) => !tool.annotations.readOnly)
            .map((tool) => tool.name)
    )
}

function percentile(values: number[], quantile: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}

export function scoreTrace(task: BenchmarkTask, trace: TraceEvent[], skillDelivery: SkillDelivery): boolean {
    const tools = trace.filter((event) => event.kind === 'tool')
    const mutations = mutationTools()
    for (const assertion of task.trace_assertions) {
        if (assertion.kind === 'tool-before') {
            const first = trace.findIndex((event) => event.kind === 'tool' && event.name === assertion.first)
            const then = trace.findIndex((event) => event.kind === 'tool' && event.name === assertion.then)
            if (first < 0 || then < 0 || first >= then) return false
        } else if (assertion.kind === 'min-calls' || assertion.kind === 'max-calls') {
            const count = tools.filter((event) => event.name === assertion.tool).length
            if (assertion.kind === 'min-calls' ? count < assertion.count : count > assertion.count) return false
        } else if (assertion.kind === 'forbidden-tool') {
            if (tools.some((event) => event.name === assertion.tool)) return false
        } else if (assertion.kind === 'required-argument' || assertion.kind === 'forbidden-argument') {
            const calls = tools.filter((event) => event.name === assertion.tool)
            if (assertion.kind === 'required-argument') {
                if (
                    calls.length === 0 ||
                    calls.some((event) => {
                        const value = readPath(event.arguments, assertion.path)
                        return (
                            value === undefined ||
                            ('equals' in assertion && JSON.stringify(value) !== JSON.stringify(assertion.equals))
                        )
                    })
                )
                    return false
            } else if (calls.some((event) => readPath(event.arguments, assertion.path) !== undefined)) return false
        } else if (assertion.kind === 'no-extra-mutations') {
            const allowed = new Set([...task.expected_tools, ...task.acceptable_tools])
            if (tools.some((event) => mutations.has(event.name) && !allowed.has(event.name))) return false
        } else if (assertion.kind === 'skill-loaded-before-tool' && skillDelivery !== 'none') {
            const skill = trace.findIndex((event) => event.kind === skillDelivery && event.name === ROLLOUT_SKILL_NAME)
            const tool = trace.findIndex((event) => event.kind === 'tool' && event.name === assertion.tool)
            if (skill < 0 || tool < 0 || skill >= tool) return false
        }
    }
    return true
}

async function scoreFinalState(task: BenchmarkTask, finalText: string, seeder: RestSeeder): Promise<boolean> {
    for (const criterion of task.success_criteria) {
        if (criterion.kind === 'answer-includes') {
            const normalized = finalText.toLocaleLowerCase()
            if (!criterion.values.every((value) => normalized.includes(value.toLocaleLowerCase()))) return false
            continue
        }
        if (criterion.kind === 'answer-excludes') {
            const normalized = finalText.toLocaleLowerCase()
            if (criterion.values.some((value) => normalized.includes(value.toLocaleLowerCase()))) return false
            continue
        }
        if (criterion.kind === 'answer-matches') {
            if (!new RegExp(criterion.pattern, 'iu').test(finalText)) return false
            continue
        }
        if (criterion.kind === 'flag-field' || criterion.kind === 'flag-json') {
            const flag = await seeder.getFlag(criterion.key)
            if (!flag) return false
            const actual = criterion.kind === 'flag-field' ? flag[criterion.field] : readPath(flag, criterion.path)
            if (
                actual === undefined && criterion.equals === null
                    ? false
                    : JSON.stringify(actual) !== JSON.stringify(criterion.equals)
            )
                return false
            continue
        }
        if (criterion.kind === 'plan-json') {
            const plan = await seeder.getPlan(criterion.key)
            if (!plan || JSON.stringify(readPath(plan, criterion.path)) !== JSON.stringify(criterion.equals)) {
                return false
            }
            continue
        }
        const flag = await seeder.getFlag(criterion.key)
        const plan = criterion.resource === 'flag' ? null : await seeder.getPlan(criterion.key)
        const exists =
            criterion.resource === 'flag'
                ? flag !== null
                : criterion.resource === 'rollout-plan'
                  ? plan !== null
                  : Array.isArray(plan?.recent_samples) && plan.recent_samples.length > 0
        if ((criterion.kind === 'record-exists') !== exists) return false
    }
    return true
}

async function skillContext(client: Client, delivery: SkillDelivery, trace: TraceEvent[]): Promise<string> {
    if (delivery === 'none') return ''
    if (delivery === 'resource') {
        const resource = await client.readResource({ uri: ROLLOUT_SKILL_URI })
        trace.push({ kind: 'resource', name: ROLLOUT_SKILL_NAME })
        const content = resource.contents[0]
        return content && 'text' in content ? content.text : ''
    }
    if (delivery === 'prompt') {
        const prompt = await client.getPrompt({
            name: ROLLOUT_SKILL_NAME,
            arguments: { intent: 'Follow the supplied user intent.' },
        })
        trace.push({ kind: 'prompt', name: ROLLOUT_SKILL_NAME })
        const content = prompt.messages[0]?.content
        return content?.type === 'text' ? content.text : ''
    }
    trace.push({ kind: 'native', name: ROLLOUT_SKILL_NAME })
    return loadRolloutSkill().content
}

async function runTrial(
    openai: OpenAI,
    model: string,
    task: BenchmarkTask,
    repetition: number,
    skillDelivery: SkillDelivery,
    seeder: RestSeeder
): Promise<TrialResult> {
    const repositoryRoot = findRepositoryRoot()
    const mcpRoot = path.join(repositoryRoot, 'services/mcp')
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(mcpRoot, 'dist/src/index.js')],
        cwd: mcpRoot,
        env: stringEnvironment(),
        stderr: 'inherit',
    })
    const client = new Client({ name: 'ensaio-agent-eval', version: 'm7-v1' })
    const trace: TraceEvent[] = []
    let resetSucceeded = false
    let finalText = ''
    let finishReason = 'error'
    let tokens: TokenCounts = {
        input: null,
        output: null,
        total: null,
    }
    let error: string | null = null
    try {
        await client.connect(transport)
        const benchmark = loadBenchmark()
        resetSucceeded = (await seeder.reset(benchmark, task)).resetSucceeded
        const tools = await client.listTools()
        const providerTools = tools.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description ?? tool.title ?? tool.name,
            parameters: tool.inputSchema,
            // OpenAPI preserves optional request fields, while OpenAI strict
            // function schemas require every property to be required.
            // MCP/AJV remains the authoritative argument validator.
            strict: false,
        }))
        const guidance = await skillContext(client, skillDelivery, trace)
        let input: unknown = [
            {
                role: 'user',
                content: guidance ? `${guidance}\n\nUser request:\n${task.intent}` : task.intent,
            },
        ]
        let previousResponseId: string | undefined
        let toolCalls = 0
        for (let turn = 0; turn < 12; turn += 1) {
            const response = (await openai.responses.create({
                model,
                input: input as never,
                tools: providerTools as never,
                max_output_tokens: 2048,
                ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
            })) as unknown as ProviderResponse
            tokens = {
                input: addTokenCount(tokens.input, response.usage?.input_tokens),
                output: addTokenCount(tokens.output, response.usage?.output_tokens),
                total: addTokenCount(tokens.total, response.usage?.total_tokens),
            }
            const calls = response.output.filter((item): item is ProviderFunctionCall => item.type === 'function_call')
            if (calls.length === 0) {
                finalText = response.output_text
                finishReason = response.status ?? 'completed'
                break
            }
            const outputs: Array<Record<string, unknown>> = []
            for (const call of calls) {
                toolCalls += 1
                if (toolCalls > 20) throw new Error('Agent exceeded the 20-tool-call budget.')
                const args = JSON.parse(call.arguments) as Record<string, unknown>
                const started = performance.now()
                const result = await client.callTool({ name: call.name, arguments: args })
                trace.push({
                    kind: 'tool',
                    name: call.name,
                    arguments: sanitizeArguments(args),
                    isError: Boolean(result.isError),
                    durationMs: Math.round(performance.now() - started),
                    ...toolTelemetry(result),
                    result: summarizeToolResult(result),
                })
                outputs.push({
                    type: 'function_call_output',
                    call_id: call.call_id,
                    output: JSON.stringify(result.structuredContent ?? result.content),
                })
            }
            input = outputs
            previousResponseId = response.id
        }
        if (!finalText) throw new Error('Agent exceeded the 12-turn budget without a final answer.')
    } catch (caught) {
        error = sanitizeEvalError(caught)
    } finally {
        await client.close().catch(() => undefined)
    }

    const toolNames = trace.filter((event) => event.kind === 'tool').map((event) => event.name)
    const toolEvents = trace.filter((event) => event.kind === 'tool')
    const toolDurations = toolEvents.flatMap((event) => (event.durationMs === undefined ? [] : [event.durationMs]))
    const expectedCovered = task.expected_tools.filter((tool) => toolNames.includes(tool)).length
    return {
        taskId: task.id,
        repetition,
        resetSucceeded,
        model,
        provider: 'openai',
        finishReason,
        skillDelivery,
        finalText,
        trace,
        scores: resetSucceeded
            ? {
                  expectedToolCoverage: expectedCovered / task.expected_tools.length,
                  forbiddenToolAvoidance: task.forbidden_tools.every((tool) => !toolNames.includes(tool)),
                  traceAssertions: scoreTrace(task, trace, skillDelivery),
                  finalState: error === null && (await scoreFinalState(task, finalText, seeder)),
                  toolErrors: toolEvents.filter((event) => event.isError).length,
                  argumentSchemaValidity: toolEvents.every((event) => event.result?.errorCode !== 'invalid_tool_call'),
                  retries: toolEvents.reduce((total, event) => total + (event.retryCount ?? 0), 0),
                  toolLatencyMs: {
                      p50: percentile(toolDurations, 0.5),
                      p95: percentile(toolDurations, 0.95),
                  },
              }
            : null,
        tokens,
        error,
    }
}

async function main(): Promise<void> {
    const apiKey = requiredEnvironment('OPENAI_API_KEY')
    const model = requiredEnvironment('ENSAIO_EVAL_MODEL')
    const repositoryRoot = findRepositoryRoot()
    const gitCommit = currentGitCommit(repositoryRoot)
    const sdkVersion = mcpSdkVersion(repositoryRoot)
    const outputIndex = process.argv.indexOf('--output')
    const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
    if (!output) throw new Error('Agent eval requires --output <filename>.')
    const resolvedOutput = path.resolve(output)
    if (fs.existsSync(resolvedOutput)) throw new Error('Agent eval output already exists; choose a new filename.')
    const repetitionsIndex = process.argv.indexOf('--repetitions')
    const repetitions = repetitionsIndex >= 0 ? Number(process.argv[repetitionsIndex + 1]) : 3
    if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('--repetitions must be a positive integer.')
    const skillIndex = process.argv.indexOf('--skill')
    const skillDelivery = (skillIndex >= 0 ? process.argv[skillIndex + 1] : 'resource') as SkillDelivery
    if (!['none', 'resource', 'prompt', 'native'].includes(skillDelivery)) throw new Error('Invalid --skill mode.')
    const onlyTaskIndex = process.argv.indexOf('--task')
    const onlyTask = onlyTaskIndex >= 0 ? process.argv[onlyTaskIndex + 1] : undefined

    const config = loadConfig()
    const benchmark = loadBenchmark()
    const tasks = onlyTask ? benchmark.tasks.filter((task) => task.id === onlyTask) : benchmark.tasks
    if (tasks.length === 0) throw new Error(`Unknown task ${onlyTask}.`)
    const openai = new OpenAI({ apiKey, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 0 })
    const seeder = new RestSeeder(config)
    const trials: TrialResult[] = []
    for (const task of tasks) {
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
            trials.push(await runTrial(openai, model, task, repetition, skillDelivery, seeder))
        }
    }
    if (!onlyTask) {
        const rolloutTask = benchmark.tasks.find((task) => task.id === 'create-health-gated-rollout')
        if (rolloutTask) trials.push(await runTrial(openai, model, rolloutTask, 0, 'none', seeder))
    }
    await seeder.cleanup()
    const artifact = {
        benchmarkVersion: benchmark.version,
        provider: 'openai',
        model,
        gitCommit,
        date: new Date().toISOString(),
        settings: {
            repetitions,
            maxTurns: 12,
            maxToolCalls: 20,
            maxOutputTokens: 2048,
            providerStrictTools: false,
            providerTimeoutMs: PROVIDER_TIMEOUT_MS,
            providerMaxRetries: 0,
        },
        skillDelivery,
        mcpSdkVersion: sdkVersion,
        trials,
    }
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true })
    fs.writeFileSync(resolvedOutput, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' })
    process.stdout.write(`Wrote ${trials.length} real agent trial(s) to ${output}.\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        process.stderr.write(`${sanitizeEvalError(error)}\n`)
        process.exitCode = 1
    })
}
