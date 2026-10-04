import fs from 'node:fs'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { loadConfig } from '../../src/config.js'
import { findRepositoryRoot } from '../../src/skill.js'
import { getTool } from '../../src/tools/catalog.js'
import { loadBenchmark } from '../benchmark/schema.js'
import { RestSeeder } from './seed.js'
import { summarizeProbes, type ProbeTrial } from './results.js'

function stringEnvironment(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
}

export async function runProbes(): Promise<ReturnType<typeof summarizeProbes>> {
    const config = loadConfig()
    const benchmark = loadBenchmark()
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
    const client = new Client({ name: 'ensaio-probe-runner', version: benchmark.version })
    const trials: ProbeTrial[] = []
    await client.connect(transport)
    try {
        const advertised = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]))
        for (const task of benchmark.tasks.filter((item) => item.probe !== null)) {
            const probe = task.probe
            if (!probe) continue
            const tool = getTool(probe.tool)
            if (!tool?.annotations.readOnly) throw new Error(`Probe ${task.id} attempted a mutating tool.`)
            await seeder.reset(benchmark, task)
            const started = performance.now()
            let success = false
            let error: string | null = null
            try {
                const advertisedTool = advertised.get(probe.tool)
                if (!advertisedTool) throw new Error('Tool is absent from tools/list.')
                if (advertisedTool.annotations?.readOnlyHint !== true) {
                    throw new Error('Tool is not advertised as read-only.')
                }
                const result = await client.callTool({ name: probe.tool, arguments: probe.arguments })
                if (result.isError) throw new Error('Tool returned an MCP error result.')
                success = true
            } catch (caught) {
                error = caught instanceof Error ? caught.message : 'Unknown probe failure.'
            }
            trials.push({
                taskId: task.id,
                tool: probe.tool,
                success,
                durationMs: Math.round(performance.now() - started),
                error,
            })
        }
    } finally {
        await client.close()
    }
    return summarizeProbes(benchmark.version, trials)
}

async function main(): Promise<void> {
    const summary = await runProbes()
    const outputIndex = process.argv.indexOf('--output')
    if (outputIndex >= 0) {
        const output = process.argv[outputIndex + 1]
        if (!output) throw new Error('--output requires a filename.')
        fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`)
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    if (summary.failed > 0) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'Probe runner failed.'}\n`)
        process.exitCode = 1
    })
}
