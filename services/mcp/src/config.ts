export type McpConfig = {
    baseUrl: string
    projectId: number
    apiToken: string
    timeoutMs: number
}

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim()
    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`)
    }
    return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
    const rawBaseUrl = required(env, 'ENSAIO_BASE_URL')
    let url: URL
    try {
        url = new URL(rawBaseUrl)
    } catch {
        throw new Error('ENSAIO_BASE_URL must be a valid absolute URL.')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('ENSAIO_BASE_URL must use http or https.')
    }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.protocol === 'http:' && !loopback && env.ENSAIO_ALLOW_INSECURE_HTTP !== '1') {
        throw new Error('Plain HTTP is allowed only for loopback hosts.')
    }
    if (url.pathname !== '/' || url.search || url.hash) {
        throw new Error('ENSAIO_BASE_URL must not contain a path, query, or fragment.')
    }

    const rawProjectId = required(env, 'ENSAIO_PROJECT_ID')
    if (!/^[1-9]\d*$/.test(rawProjectId)) {
        throw new Error('ENSAIO_PROJECT_ID must be a positive integer.')
    }
    const projectId = Number(rawProjectId)
    if (!Number.isSafeInteger(projectId)) {
        throw new Error('ENSAIO_PROJECT_ID must be a safe positive integer.')
    }

    const apiToken = required(env, 'ENSAIO_API_TOKEN')
    if (!apiToken.startsWith('ens_pat_')) {
        throw new Error('ENSAIO_API_TOKEN must be an ens_pat_ automation token.')
    }

    const rawTimeout = env.ENSAIO_REQUEST_TIMEOUT_MS?.trim() ?? '10000'
    if (!/^\d+$/.test(rawTimeout)) {
        throw new Error('ENSAIO_REQUEST_TIMEOUT_MS must be an integer.')
    }
    const timeoutMs = Number(rawTimeout)
    if (timeoutMs < 100 || timeoutMs > 60_000) {
        throw new Error('ENSAIO_REQUEST_TIMEOUT_MS must be between 100 and 60000.')
    }

    return {
        baseUrl: url.origin,
        projectId,
        apiToken,
        timeoutMs,
    }
}
