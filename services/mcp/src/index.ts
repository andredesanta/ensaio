#!/usr/bin/env node
import { redactText } from './apiClient.js'
import { loadConfig } from './config.js'
import { runStdioServer } from './server.js'

async function main(): Promise<void> {
    const config = loadConfig()
    await runStdioServer(config)
}

main().catch((error: unknown) => {
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    const message = error instanceof Error ? error.message : 'MCP server failed to start.'
    process.stderr.write(
        `${JSON.stringify({ event: 'mcp_server_failed', error_type: errorType, detail: redactText(message) })}\n`
    )
    process.exitCode = 1
})
