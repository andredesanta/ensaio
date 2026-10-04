import { describe, expect, it, vi } from 'vitest'

import { EnsaioApiClient, redactText, type ToolCallLog } from '../src/apiClient.js'
import type { McpConfig } from '../src/config.js'

const config: McpConfig = {
    baseUrl: 'http://127.0.0.1:8000',
    projectId: 3,
    apiToken: 'ens_pat_FAKE_SELECTOR.FAKE_SECRET',
    timeoutMs: 500,
}

describe('EnsaioApiClient', () => {
    it('injects authorization and logs only controlled metadata', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ id: 4 }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        )
        const logs: ToolCallLog[] = []
        const client = new EnsaioApiClient(config, fetchMock, (record) => logs.push(record))

        await expect(
            client.request({
                toolName: 'feature-flag-get',
                readOnly: true,
                method: 'GET',
                path: '/api/projects/3/feature_flags/4/',
            })
        ).resolves.toMatchObject({
            data: { id: 4 },
            telemetry: { tool: 'feature-flag-get', status: 'ok', retry_count: 0 },
        })

        const request = fetchMock.mock.calls[0]
        expect(String(request?.[0])).toBe('http://127.0.0.1:8000/api/projects/3/feature_flags/4/')
        expect(new Headers(request?.[1]?.headers).get('Authorization')).toBe(`Bearer ${config.apiToken}`)
        expect(JSON.stringify(logs)).not.toContain(config.apiToken)
        expect(logs[0]).toMatchObject({ tool: 'feature-flag-get', status: 'ok', retry_count: 0 })
    })

    it('preserves validation details and controlled conflict codes', async () => {
        const body = { detail: 'Changed.', code: 'version_conflict', current_version: 8 }
        const client = new EnsaioApiClient(
            config,
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(JSON.stringify(body), {
                    status: 409,
                    headers: { 'content-type': 'application/json' },
                })
            ),
            () => undefined
        )

        try {
            await client.request({
                toolName: 'feature-flag-update-metadata',
                readOnly: false,
                method: 'PATCH',
                path: '/flags/4',
            })
            throw new Error('Expected the API request to fail.')
        } catch (error) {
            expect(error).toMatchObject({
                kind: 'conflict',
                status: 409,
                code: 'version_conflict',
                details: body,
                telemetry: { status: 'error', retry_count: 0 },
            })
        }
    })

    it('retries a read connection failure once but never retries a mutation', async () => {
        const readFetch = vi
            .fn<typeof fetch>()
            .mockRejectedValueOnce(new TypeError('connection reset'))
            .mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
        const writeFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('connection reset'))
        const readClient = new EnsaioApiClient(config, readFetch, () => undefined)
        const writeClient = new EnsaioApiClient(config, writeFetch, () => undefined)

        await readClient.request({
            toolName: 'feature-flag-list',
            readOnly: true,
            method: 'GET',
            path: '/flags',
        })
        await expect(
            writeClient.request({
                toolName: 'feature-flag-create',
                readOnly: false,
                method: 'POST',
                path: '/flags',
            })
        ).rejects.toMatchObject({ kind: 'network' })

        expect(readFetch).toHaveBeenCalledTimes(2)
        expect(writeFetch).toHaveBeenCalledTimes(1)
    })

    it('redacts every Ensaio token family from diagnostic text', () => {
        expect(redactText('ens_pat_a.b ens_pub_c ens_sec_d')).toBe('[REDACTED] [REDACTED] [REDACTED]')
    })
})
