import { randomUUID } from 'node:crypto'

import type { McpConfig } from './config.js'

export type ApiFailureKind =
    | 'validation'
    | 'authentication'
    | 'authorization'
    | 'not_found'
    | 'conflict'
    | 'timeout'
    | 'network'
    | 'server'
    | 'unexpected'

export class EnsaioApiError extends Error {
    public telemetry: ToolCallLog | null = null

    public constructor(
        public readonly kind: ApiFailureKind,
        public readonly status: number | null,
        public readonly code: string | null,
        public readonly details: unknown,
        message: string
    ) {
        super(message)
        this.name = 'EnsaioApiError'
    }
}

export type ApiRequest = {
    toolName: string
    readOnly: boolean
    method: string
    path: string
    query?: Record<string, unknown>
    body?: Record<string, unknown>
}

export type ToolCallLog = {
    event: 'mcp_tool_call'
    request_id: string
    tool: string
    classification: 'read' | 'write'
    status: 'ok' | 'error'
    http_status: number | null
    duration_ms: number
    retry_count: number
    error_type?: string
    error_code?: string
}

export type ApiResult = {
    data: unknown
    telemetry: ToolCallLog
}

type Logger = (record: ToolCallLog) => void

const TOKEN_PATTERN = /ens_(?:pat|pub|sec)_[A-Za-z0-9_.-]+/g

export function redactText(value: string): string {
    return value.replace(TOKEN_PATTERN, '[REDACTED]')
}

function defaultLogger(record: ToolCallLog): void {
    process.stderr.write(`${JSON.stringify(record)}\n`)
}

function failureKind(status: number): ApiFailureKind {
    if (status === 400 || status === 422) return 'validation'
    if (status === 401) return 'authentication'
    if (status === 403) return 'authorization'
    if (status === 404) return 'not_found'
    if (status === 409) return 'conflict'
    if (status >= 500) return 'server'
    return 'unexpected'
}

function safeMessage(status: number, body: unknown): string {
    if (typeof body === 'object' && body !== null && 'detail' in body) {
        const detail = (body as { detail?: unknown }).detail
        if (typeof detail === 'string') {
            return redactText(detail)
        }
    }
    return `Ensaio API request failed with status ${status}.`
}

function bodyCode(body: unknown): string | null {
    if (typeof body === 'object' && body !== null && 'code' in body) {
        const code = (body as { code?: unknown }).code
        return typeof code === 'string' ? code : null
    }
    return null
}

async function responseBody(response: Response): Promise<unknown> {
    if (response.status === 204) return null
    const text = await response.text()
    if (!text) return null
    if (response.headers.get('content-type')?.includes('application/json')) {
        try {
            return JSON.parse(text) as unknown
        } catch {
            return null
        }
    }
    return null
}

export class EnsaioApiClient {
    public constructor(
        private readonly config: McpConfig,
        private readonly fetchFn: typeof fetch = fetch,
        private readonly logger: Logger = defaultLogger
    ) {}

    public async request(request: ApiRequest): Promise<ApiResult> {
        const requestId = randomUUID()
        const startedAt = performance.now()
        let retries = 0
        let httpStatus: number | null = null
        try {
            const url = new URL(request.path, this.config.baseUrl)
            for (const [key, value] of Object.entries(request.query ?? {})) {
                if (value !== undefined && value !== null) {
                    url.searchParams.set(key, String(value))
                }
            }

            const maxAttempts = request.method === 'GET' && request.readOnly ? 2 : 1
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
                try {
                    const response = await this.fetchFn(url, {
                        method: request.method,
                        headers: {
                            Accept: 'application/json',
                            Authorization: `Bearer ${this.config.apiToken}`,
                            'Content-Type': 'application/json',
                            'X-Request-ID': requestId,
                        },
                        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
                        signal: controller.signal,
                    })
                    httpStatus = response.status
                    const body = await responseBody(response)
                    if (!response.ok) {
                        throw new EnsaioApiError(
                            failureKind(response.status),
                            response.status,
                            bodyCode(body),
                            body,
                            safeMessage(response.status, body)
                        )
                    }
                    const telemetry: ToolCallLog = {
                        event: 'mcp_tool_call',
                        request_id: requestId,
                        tool: request.toolName,
                        classification: request.readOnly ? 'read' : 'write',
                        status: 'ok',
                        http_status: response.status,
                        duration_ms: Math.round(performance.now() - startedAt),
                        retry_count: retries,
                    }
                    this.logger(telemetry)
                    return { data: body, telemetry }
                } catch (error) {
                    const timedOut = controller.signal.aborted
                    const retryableNetworkError = error instanceof TypeError && !timedOut
                    if (attempt < maxAttempts && retryableNetworkError) {
                        retries += 1
                        continue
                    }
                    if (error instanceof EnsaioApiError) throw error
                    if (timedOut) {
                        throw new EnsaioApiError('timeout', null, null, null, 'Ensaio API request timed out.')
                    }
                    throw new EnsaioApiError('network', null, null, null, 'Ensaio API connection failed.')
                } finally {
                    clearTimeout(timeout)
                }
            }
            throw new EnsaioApiError('unexpected', null, null, null, 'Ensaio API request did not complete.')
        } catch (error) {
            const apiError =
                error instanceof EnsaioApiError
                    ? error
                    : new EnsaioApiError('unexpected', null, null, null, 'Unexpected Ensaio API failure.')
            const telemetry: ToolCallLog = {
                event: 'mcp_tool_call',
                request_id: requestId,
                tool: request.toolName,
                classification: request.readOnly ? 'read' : 'write',
                status: 'error',
                http_status: httpStatus,
                duration_ms: Math.round(performance.now() - startedAt),
                retry_count: retries,
                error_type: apiError.kind,
                ...(apiError.code === null ? {} : { error_code: apiError.code }),
            }
            apiError.telemetry = telemetry
            this.logger(telemetry)
            throw apiError
        }
    }
}
