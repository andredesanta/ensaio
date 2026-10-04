import { describe, expect, it, vi } from 'vitest'

import { loadBenchmark } from '../evals/benchmark/schema.js'
import { ROLLOUT_SKILL_NAME } from '../src/skill.js'
import { sanitizeArguments, sanitizeEvalError, scoreTrace } from '../evals/runner/agent.js'
import { summarizeProbes } from '../evals/runner/results.js'
import { RestSeeder } from '../evals/runner/seed.js'
import type { McpConfig } from '../src/config.js'

const config: McpConfig = {
    baseUrl: 'http://127.0.0.1:8000',
    projectId: 1,
    apiToken: 'ens_pat_FAKE_SELECTOR.FAKE_SECRET',
    timeoutMs: 500,
}

describe('M7 benchmark', () => {
    it('strictly validates twelve isolated tasks and read-only probes', () => {
        const benchmark = loadBenchmark()

        expect(benchmark.version).toBe('m7-v1')
        expect(benchmark.tasks).toHaveLength(12)
        expect(new Set(benchmark.tasks.map((task) => task.fixture)).size).toBe(12)
        expect(benchmark.tasks.filter((task) => task.probe)).toHaveLength(4)
        const rollout = benchmark.tasks.find((task) => task.id === 'create-health-gated-rollout')
        expect(rollout?.success_criteria.filter((criterion) => criterion.kind === 'plan-json')).toHaveLength(14)
        const conflict = benchmark.tasks.find((task) => task.id === 'handle-managed-rollout-conflict')
        expect(conflict?.success_criteria).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'flag-json',
                    path: 'filters.groups.0.rollout_percentage',
                    equals: 25,
                }),
                expect.objectContaining({ kind: 'plan-json', path: 'status', equals: 'ACTIVE' }),
            ])
        )
        const breachedSample = benchmark.tasks.find((task) => task.id === 'record-breached-latency')
        expect(breachedSample?.success_criteria).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'answer-excludes' })])
        )
        const trace = benchmark.tasks.find((task) => task.id === 'trace-brazilian-pro-subject')
        expect(trace?.success_criteria).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'answer-matches' })])
        )
    })

    it('aggregates deterministic latency percentiles and failures', () => {
        const summary = summarizeProbes('m7-v1', [
            { taskId: 'a', tool: 'one', success: true, durationMs: 10, error: null },
            { taskId: 'b', tool: 'two', success: false, durationMs: 20, error: 'failed' },
            { taskId: 'c', tool: 'three', success: true, durationMs: 30, error: null },
        ])

        expect(summary).toMatchObject({
            attempted: 3,
            succeeded: 2,
            failed: 1,
            latencyMs: { p50: 20, p95: 30 },
        })
    })

    it('recursively removes credentials, person properties, and payloads from eval traces', () => {
        expect(
            sanitizeArguments({
                distinct_id: 'person-1',
                filters: {
                    groups: [{ properties: [{ key: 'email', value: 'andre@example.com' }] }],
                    payloads: { test: { secret: 'visible-to-the-flag' } },
                },
                nested_token: 'ens_pat_selector.secret',
            })
        ).toEqual({
            distinct_id: '[REDACTED]',
            filters: {
                groups: [{ properties: '[REDACTED]' }],
                payloads: '[REDACTED]',
            },
            nested_token: '[REDACTED]',
        })
    })

    it('removes provider and Ensaio credentials from recorded eval errors', () => {
        const env = {
            OPENAI_API_KEY: 'provider-secret',
            ENSAIO_API_TOKEN: 'ens_pat_selector.secret',
        }
        expect(sanitizeEvalError(new Error('provider-secret ens_pat_selector.secret failed'), env)).toBe(
            '[REDACTED] [REDACTED] failed'
        )
    })

    it('refuses to run fixtures in a project containing non-benchmark flags', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify([{ id: 1, key: 'private-production-name' }]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        )

        await expect(new RestSeeder(config, fetchMock).cleanup()).rejects.toThrow('found 1 non-fixture flag(s)')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('scores the skill channel selected for a prompt or native comparison run', () => {
        const task = loadBenchmark().tasks.find((item) => item.id === 'create-health-gated-rollout')
        expect(task).toBeDefined()
        const toolTrace = [
            { kind: 'tool' as const, name: 'feature-flag-get-by-key', arguments: { key: 'mcp-eval-health-rollout' } },
            { kind: 'tool' as const, name: 'rollout-plan-get', arguments: { id: 1 } },
            { kind: 'prompt' as const, name: ROLLOUT_SKILL_NAME },
            {
                kind: 'tool' as const,
                name: 'rollout-plan-set',
                arguments: { expected_plan_id: null, expected_version: null },
            },
        ]

        expect(scoreTrace(task!, toolTrace, 'prompt')).toBe(true)
        expect(scoreTrace(task!, toolTrace, 'native')).toBe(false)
    })
})
