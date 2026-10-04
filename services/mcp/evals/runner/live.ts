import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { loadConfig } from '../../src/config.js'
import { findRepositoryRoot, ROLLOUT_SKILL_URI } from '../../src/skill.js'
import { RestSeeder } from './seed.js'

function stringEnvironment(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
}

async function call(
    client: Client,
    name: string,
    arguments_: Record<string, unknown>
): Promise<Record<string, unknown>> {
    const result = await client.callTool({ name, arguments: arguments_ })
    if (result.isError || !result.structuredContent) {
        throw new Error(`Live MCP tool ${name} failed: ${JSON.stringify(result.content)}`)
    }
    return result.structuredContent as Record<string, unknown>
}

async function main(): Promise<void> {
    const config = loadConfig()
    const repositoryRoot = findRepositoryRoot()
    const mcpRoot = path.join(repositoryRoot, 'services/mcp')
    const seeder = new RestSeeder(config)
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(mcpRoot, 'dist/src/index.js')],
        cwd: mcpRoot,
        env: stringEnvironment(),
        stderr: 'inherit',
    })
    const client = new Client({ name: 'ensaio-live-workflow', version: 'm7-v1' })
    const key = 'mcp-eval-live-workflow'
    const called: string[] = []
    await seeder.cleanup()
    await client.connect(transport)
    try {
        await client.readResource({ uri: ROLLOUT_SKILL_URI })
        const absent = await call(client, 'feature-flag-get-by-key', { key })
        called.push('feature-flag-get-by-key')
        if (absent.exists !== false) throw new Error('Live workflow expected an absent exact key.')

        const created = await call(client, 'feature-flag-create', {
            key,
            name: 'Synthetic live MCP workflow',
            active: true,
            filters: {
                groups: [{ properties: [], rollout_percentage: 10, variant: null }],
            },
        })
        called.push('feature-flag-create')
        const flagId = created.id
        if (typeof flagId !== 'number') throw new Error('Live workflow create returned no numeric flag ID.')

        await call(client, 'feature-flag-trace', {
            id: flagId,
            distinct_id: 'synthetic-live-subject',
            properties: {},
        })
        called.push('feature-flag-trace')

        const absentPlan = await call(client, 'rollout-plan-get', { id: flagId })
        called.push('rollout-plan-get')
        if (absentPlan.exists !== false) throw new Error('Live workflow expected no initial rollout plan.')

        await call(client, 'rollout-plan-set', {
            id: flagId,
            status: 'DRAFT',
            managed_group_index: 0,
            phases: [
                { percentage: 10, min_duration_minutes: 5 },
                { percentage: 50, min_duration_minutes: 10 },
                { percentage: 100, min_duration_minutes: 15 },
            ],
            guardrail: {
                name: 'latency_ms',
                comparison: 'lt',
                threshold: 300,
                window_minutes: 15,
                min_samples: 100,
                max_hold_minutes: 30,
            },
            expected_plan_id: null,
            expected_version: null,
        })
        called.push('rollout-plan-set')
        const plan = await seeder.getPlan(key)
        if (!plan || plan.status !== 'DRAFT') throw new Error('Live workflow final plan assertion failed.')
        process.stdout.write(
            `${JSON.stringify({
                workflow: 'create-trace-rollout-plan',
                skillDelivery: 'resource',
                called,
                finalPlanStatus: plan.status,
            })}\n`
        )
    } finally {
        await client.close().catch(() => undefined)
        await seeder.cleanup()
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Live MCP workflow failed.'}\n`)
    process.exitCode = 1
})
