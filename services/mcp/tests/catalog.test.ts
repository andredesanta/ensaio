import { describe, expect, it, vi } from 'vitest'

import { EnsaioApiClient } from '../src/apiClient.js'
import type { McpConfig } from '../src/config.js'
import { executeTool, getCatalog, getTool, validateToolArguments, validateToolResult } from '../src/tools/catalog.js'

const config: McpConfig = {
    baseUrl: 'http://127.0.0.1:8000',
    projectId: 9,
    apiToken: 'ens_pat_FAKE_SELECTOR.FAKE_SECRET',
    timeoutMs: 500,
}

describe('generated tool catalog', () => {
    it('contains exactly the twelve scoped tools with no project or credential input', () => {
        const catalog = getCatalog()
        expect(catalog.tools).toHaveLength(12)
        for (const tool of catalog.tools) {
            const properties = Object.keys(tool.inputSchema.properties ?? {})
            expect(properties).not.toContain('team_id')
            expect(properties).not.toContain('Authorization')
            expect(tool.scopes.length).toBeGreaterThan(0)
            expect(tool.annotations.destructive).toBe(false)
        }
    })

    it('restricts metadata updates and requires the concurrency version', () => {
        const tool = getTool('feature-flag-update-metadata')
        expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(['id', 'key', 'name', 'expected_version'])
        expect(tool?.inputSchema.required).toContain('expected_version')
        expect(() =>
            validateToolArguments('feature-flag-update-metadata', {
                id: 1,
                filters: { groups: [] },
                expected_version: 2,
            })
        ).toThrow('additional properties')
    })

    it('rejects API results that do not satisfy the generated output contract', () => {
        expect(() => validateToolResult('feature-flag-get', { id: 1, key: 'incomplete' })).toThrow(
            'Invalid tool result'
        )
    })

    it('resolves single-member allOf enums without changing their scalar type', () => {
        const tool = getTool('rollout-plan-set')
        expect(tool?.inputSchema.properties?.status).toMatchObject({
            type: 'string',
            enum: ['DRAFT', 'ACTIVE', 'HOLDING', 'PAUSED', 'COMPLETED', 'REVERTED'],
        })
        expect(() =>
            validateToolArguments('rollout-plan-set', {
                id: 1,
                expected_plan_id: null,
                expected_version: null,
                status: 'DRAFT',
                managed_group_index: 0,
                phases: [{ percentage: 10, min_duration_minutes: 5 }],
                guardrail: {
                    name: 'errors',
                    comparison: 'lt',
                    threshold: 1,
                    window_minutes: 5,
                    min_samples: 10,
                    max_hold_minutes: 30,
                },
            })
        ).not.toThrow()
        expect(getTool('feature-flag-get')?.outputSchema.properties?.rollout_plan_status?.oneOf).toHaveLength(2)
    })

    it('normalizes only the controlled exact-key absence code', async () => {
        const tool = getTool('feature-flag-get-by-key')
        expect(tool).toBeDefined()
        const controlledFetch = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ detail: 'Missing.', code: 'flag_not_found' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            })
        )
        const unexpectedFetch = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ detail: 'Project missing.', code: 'project_not_found' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            })
        )

        await expect(
            executeTool(
                tool!,
                { key: 'missing' },
                config,
                new EnsaioApiClient(config, controlledFetch, () => undefined)
            )
        ).resolves.toEqual({ exists: false, key: 'missing' })
        await expect(
            executeTool(
                tool!,
                { key: 'missing' },
                config,
                new EnsaioApiClient(config, unexpectedFetch, () => undefined)
            )
        ).rejects.toMatchObject({ code: 'project_not_found' })
    })

    it('injects project paths and projects success responses', async () => {
        const tool = getTool('feature-flag-enable')
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 4,
                    team_id: 9,
                    key: 'checkout',
                    name: '',
                    active: true,
                    version: 2,
                    filters: { groups: [] },
                    rollout_plan_status: null,
                    secret: 'drop-me',
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            )
        )

        const result = await executeTool(
            tool!,
            { id: 4 },
            config,
            new EnsaioApiClient(config, fetchMock, () => undefined)
        )

        expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/projects/9/feature_flags/4/enable/')
        expect(result).not.toHaveProperty('team_id')
        expect(result).not.toHaveProperty('secret')
    })
})
