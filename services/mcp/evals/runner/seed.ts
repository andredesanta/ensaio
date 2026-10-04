import type { McpConfig } from '../../src/config.js'
import type { Benchmark, BenchmarkTask } from '../benchmark/schema.js'

type JsonObject = Record<string, unknown>

export type SeedResult = {
    resetSucceeded: boolean
    flagId: number | null
    planId: number | null
}

export class RestSeeder {
    public constructor(
        private readonly config: McpConfig,
        private readonly fetchFn: typeof fetch = fetch
    ) {}

    private async request(method: string, path: string, body?: JsonObject): Promise<unknown> {
        const response = await this.fetchFn(new URL(path, this.config.baseUrl), {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${this.config.apiToken}`,
                'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(this.config.timeoutMs),
        })
        const value = response.status === 204 ? null : ((await response.json()) as unknown)
        if (!response.ok) throw new Error(`REST fixture request failed with status ${response.status}.`)
        return value
    }

    public async cleanup(): Promise<void> {
        const flags = (await this.request(
            'GET',
            `/api/projects/${this.config.projectId}/feature_flags/`
        )) as JsonObject[]
        const nonFixtureKeys = flags
            .map((flag) => flag.key)
            .filter((key): key is string => typeof key === 'string' && !key.startsWith('mcp-eval-'))
        if (nonFixtureKeys.length > 0) {
            throw new Error(
                `Agent eval requires a dedicated project; found ${nonFixtureKeys.length} non-fixture flag(s).`
            )
        }
        for (const flag of flags) {
            if (typeof flag.key === 'string' && flag.key.startsWith('mcp-eval-') && typeof flag.id === 'number') {
                await this.request('DELETE', `/api/projects/${this.config.projectId}/feature_flags/${flag.id}/`)
            }
        }
    }

    public async reset(benchmark: Benchmark, task: BenchmarkTask): Promise<SeedResult> {
        await this.cleanup()
        if (!task.fixture) return { resetSucceeded: true, flagId: null, planId: null }
        const fixture = benchmark.fixtures[task.fixture]
        if (!fixture) throw new Error(`Unknown fixture ${task.fixture}.`)
        if (!fixture.present) return { resetSucceeded: true, flagId: null, planId: null }
        const flag = (await this.request('POST', `/api/projects/${this.config.projectId}/feature_flags/`, {
            key: fixture.key,
            ...fixture.flag,
        })) as JsonObject
        const flagId = typeof flag.id === 'number' ? flag.id : null
        if (flagId === null) throw new Error('Fixture create response did not contain a numeric flag ID.')
        let planId: number | null = null
        if (fixture.plan) {
            const plan = (await this.request(
                'PUT',
                `/api/projects/${this.config.projectId}/feature_flags/${flagId}/rollout_plan/`,
                {
                    ...fixture.plan,
                    expected_plan_id: null,
                    expected_version: null,
                }
            )) as JsonObject
            planId = typeof plan.id === 'number' ? plan.id : null
        }
        return { resetSucceeded: true, flagId, planId }
    }

    public async getFlag(key: string): Promise<JsonObject | null> {
        const response = await this.fetchFn(
            new URL(
                `/api/projects/${this.config.projectId}/feature_flags/by_key/?key=${encodeURIComponent(key)}`,
                this.config.baseUrl
            ),
            {
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${this.config.apiToken}`,
                },
                signal: AbortSignal.timeout(this.config.timeoutMs),
            }
        )
        if (response.status === 404) return null
        if (!response.ok) throw new Error(`REST fixture read failed with status ${response.status}.`)
        return (await response.json()) as JsonObject
    }

    public async getPlan(key: string): Promise<JsonObject | null> {
        const flag = await this.getFlag(key)
        if (!flag || typeof flag.id !== 'number') return null
        const response = await this.fetchFn(
            new URL(
                `/api/projects/${this.config.projectId}/feature_flags/${flag.id}/rollout_plan/`,
                this.config.baseUrl
            ),
            {
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${this.config.apiToken}`,
                },
                signal: AbortSignal.timeout(this.config.timeoutMs),
            }
        )
        if (response.status === 404) return null
        if (!response.ok) throw new Error(`REST plan read failed with status ${response.status}.`)
        return (await response.json()) as JsonObject
    }
}
