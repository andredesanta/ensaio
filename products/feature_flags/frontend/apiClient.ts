export class ApiError extends Error {
    public readonly status: number
    public readonly body: unknown

    public constructor(status: number, body: unknown) {
        super(`API request failed with status ${status}`)
        this.name = 'ApiError'
        this.status = status
        this.body = body
    }
}

function cookieValue(name: string): string | undefined {
    const prefix = `${encodeURIComponent(name)}=`
    const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix))
    return cookie === undefined ? undefined : decodeURIComponent(cookie.slice(prefix.length))
}

async function responseBody(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return undefined
    }
    const contentType = response.headers.get('content-type') ?? ''
    return contentType.includes('application/json') ? response.json() : response.text()
}

export async function apiClient<T>(url: string, options: RequestInit): Promise<T> {
    const headers = new Headers(options.headers)
    const method = options.method?.toUpperCase() ?? 'GET'
    if (options.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
    }
    if (!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)) {
        const csrfToken = cookieValue('csrftoken')
        if (csrfToken !== undefined) {
            headers.set('X-CSRFToken', csrfToken)
        }
    }

    const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
    })
    const body = await responseBody(response)
    if (!response.ok) {
        throw new ApiError(response.status, body)
    }
    return {
        data: body,
        status: response.status,
        headers: response.headers,
    } as T
}

export function apiErrorMessage(error: unknown): string {
    if (error instanceof ApiError && typeof error.body === 'object' && error.body !== null) {
        return JSON.stringify(error.body)
    }
    return error instanceof Error ? error.message : 'Unknown API error'
}
