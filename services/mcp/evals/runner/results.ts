export type ProbeTrial = {
    taskId: string
    tool: string
    success: boolean
    durationMs: number
    error: string | null
}

export type ProbeSummary = {
    benchmarkVersion: string
    attempted: number
    succeeded: number
    failed: number
    latencyMs: {
        p50: number
        p95: number
    }
    trials: ProbeTrial[]
}

function percentile(values: number[], quantile: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((left, right) => left - right)
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
    return sorted[index] ?? 0
}

export function summarizeProbes(benchmarkVersion: string, trials: ProbeTrial[]): ProbeSummary {
    return {
        benchmarkVersion,
        attempted: trials.length,
        succeeded: trials.filter((trial) => trial.success).length,
        failed: trials.filter((trial) => !trial.success).length,
        latencyMs: {
            p50: percentile(
                trials.map((trial) => trial.durationMs),
                0.5
            ),
            p95: percentile(
                trials.map((trial) => trial.durationMs),
                0.95
            ),
        },
        trials,
    }
}
