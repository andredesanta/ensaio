import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { McpConfig } from '../src/config.js'
import { createServer } from '../src/server.js'
import { findRepositoryRoot, ROLLOUT_SKILL_NAME, ROLLOUT_SKILL_URI } from '../src/skill.js'

const config: McpConfig = {
    baseUrl: 'http://127.0.0.1:8000',
    projectId: 2,
    apiToken: 'ens_pat_FAKE_SELECTOR.FAKE_SECRET',
    timeoutMs: 500,
}

describe('MCP protocol', () => {
    const closeables: Array<{ close: () => Promise<void> }> = []

    afterEach(async () => {
        await Promise.all(closeables.splice(0).map((item) => item.close()))
    })

    it('initializes and discovers tools, the rollout resource, and prompt', async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const server = createServer(config)
        const client = new Client({ name: 'protocol-test', version: '1.0.0' })
        closeables.push(client, server)
        await server.connect(serverTransport)
        await client.connect(clientTransport)

        const tools = await client.listTools()
        const resources = await client.listResources()
        const prompts = await client.listPrompts()
        const resource = await client.readResource({ uri: ROLLOUT_SKILL_URI })
        const prompt = await client.getPrompt({
            name: ROLLOUT_SKILL_NAME,
            arguments: { intent: 'Roll checkout out in three stages.' },
        })

        expect(tools.tools).toHaveLength(12)
        expect(tools.tools.find((tool) => tool.name === 'feature-flag-disable')?.annotations).toMatchObject({
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
        })
        expect(tools.tools.find((tool) => tool.name === 'feature-flag-get-by-key')?.outputSchema).toMatchObject({
            oneOf: expect.any(Array),
        })
        expect(resources.resources.map((item) => item.uri)).toEqual([ROLLOUT_SKILL_URI])
        expect(prompts.prompts.map((item) => item.name)).toEqual([ROLLOUT_SKILL_NAME])
        expect(resource.contents[0]).toMatchObject({
            uri: ROLLOUT_SKILL_URI,
            mimeType: 'text/markdown',
        })
        expect(prompt.messages[0]?.content).toMatchObject({ type: 'text' })
        expect(prompt.messages[0]?.content).toMatchObject({
            text: expect.stringContaining('# Managing health-gated rollouts'),
        })
    })

    it('calls a generated tool over HTTP and returns the expected union envelope', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 5,
                    team_id: 2,
                    key: 'checkout',
                    name: 'Checkout',
                    active: true,
                    version: 3,
                    filters: { groups: [] },
                    rollout_plan_status: null,
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            )
        )
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const server = createServer(config, fetchMock)
        const client = new Client({ name: 'protocol-test', version: '1.0.0' })
        closeables.push(client, server)
        await server.connect(serverTransport)
        await client.connect(clientTransport)

        const result = await client.callTool({
            name: 'feature-flag-get-by-key',
            arguments: { key: 'checkout' },
        })

        expect(result.isError).not.toBe(true)
        expect(result.structuredContent).toMatchObject({
            exists: true,
            flag: { id: 5, key: 'checkout', version: 3 },
        })
        expect(result._meta).toMatchObject({
            ensaio: { duration_ms: expect.any(Number), retry_count: 0 },
        })
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/projects/2/feature_flags/by_key/?key=checkout')
    })

    it('serves protocol-only stdio from an unrelated working directory', async () => {
        const httpServer = createHttpServer((_request, response) => {
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end(
                JSON.stringify({
                    id: 5,
                    key: 'checkout',
                    name: 'Checkout',
                    active: true,
                    version: 3,
                    filters: { groups: [] },
                    rollout_plan_status: null,
                })
            )
        })
        await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
        const address = httpServer.address() as AddressInfo
        const repositoryRoot = findRepositoryRoot()
        const mcpRoot = path.join(repositoryRoot, 'services/mcp')
        const environment = Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
        )
        const transport = new StdioClientTransport({
            command: path.join(mcpRoot, 'node_modules/.bin/tsx'),
            args: [path.join(mcpRoot, 'src/index.ts')],
            cwd: os.tmpdir(),
            env: {
                ...environment,
                ENSAIO_BASE_URL: `http://127.0.0.1:${address.port}`,
                ENSAIO_PROJECT_ID: '2',
                ENSAIO_API_TOKEN: 'ens_pat_FAKE_SELECTOR.FAKE_SECRET',
            },
            stderr: 'pipe',
        })
        const client = new Client({ name: 'stdio-protocol-test', version: '1.0.0' })
        try {
            await client.connect(transport)
            expect((await client.listTools()).tools).toHaveLength(12)
            expect((await client.readResource({ uri: ROLLOUT_SKILL_URI })).contents[0]).toMatchObject({
                uri: ROLLOUT_SKILL_URI,
            })
            expect(
                (
                    await client.getPrompt({
                        name: ROLLOUT_SKILL_NAME,
                        arguments: { intent: 'Inspect checkout.' },
                    })
                ).messages
            ).toHaveLength(1)
            const result = await client.callTool({
                name: 'feature-flag-get-by-key',
                arguments: { key: 'checkout' },
            })
            expect(result.isError).not.toBe(true)
            expect(result.structuredContent).toMatchObject({ exists: true, flag: { key: 'checkout' } })
        } finally {
            await client.close().catch(() => undefined)
            await new Promise<void>((resolve, reject) =>
                httpServer.close((error) => (error ? reject(error) : resolve()))
            )
        }
    })
})
