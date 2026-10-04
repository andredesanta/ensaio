import fs from 'node:fs'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { findRepositoryRoot } from '../../src/skill.js'
import { getCatalog } from '../../src/tools/catalog.js'

/* oxlint-disable unicorn/no-thenable -- "then" is the benchmark contract's ordered second tool. */
const toolBefore = z.object({ kind: z.literal('tool-before'), first: z.string(), then: z.string() }).strict()
/* oxlint-enable unicorn/no-thenable */
const callCount = z
    .object({
        kind: z.enum(['min-calls', 'max-calls']),
        tool: z.string(),
        count: z.number().int().nonnegative(),
    })
    .strict()
const argumentAssertion = z
    .object({
        kind: z.enum(['required-argument', 'forbidden-argument']),
        tool: z.string(),
        path: z.string().min(1),
        equals: z.unknown().optional(),
    })
    .strict()
const forbiddenTool = z.object({ kind: z.literal('forbidden-tool'), tool: z.string() }).strict()
const noExtraMutations = z.object({ kind: z.literal('no-extra-mutations') }).strict()
const skillLoaded = z
    .object({
        kind: z.literal('skill-loaded-before-tool'),
        tool: z.string(),
        delivery: z.enum(['resource', 'prompt', 'native']),
    })
    .strict()

export const traceAssertionSchema = z.union([
    toolBefore,
    callCount,
    argumentAssertion,
    forbiddenTool,
    noExtraMutations,
    skillLoaded,
])

const flagField = z
    .object({
        kind: z.literal('flag-field'),
        key: z.string(),
        field: z.string(),
        equals: z.unknown(),
    })
    .strict()
const flagJson = z
    .object({
        kind: z.literal('flag-json'),
        key: z.string(),
        path: z.string(),
        equals: z.unknown(),
    })
    .strict()
const planJson = z
    .object({
        kind: z.literal('plan-json'),
        key: z.string(),
        path: z.string(),
        equals: z.unknown(),
    })
    .strict()
const recordExists = z
    .object({
        kind: z.enum(['record-exists', 'record-absent']),
        resource: z.enum(['flag', 'rollout-plan', 'guardrail-sample']),
        key: z.string(),
    })
    .strict()
const answerIncludes = z
    .object({
        kind: z.literal('answer-includes'),
        values: z.array(z.string()).min(1),
    })
    .strict()
const answerExcludes = z
    .object({
        kind: z.literal('answer-excludes'),
        values: z.array(z.string()).min(1),
    })
    .strict()
const answerMatches = z
    .object({
        kind: z.literal('answer-matches'),
        pattern: z
            .string()
            .min(1)
            .refine((pattern) => {
                try {
                    new RegExp(pattern, 'iu')
                    return true
                } catch {
                    return false
                }
            }, 'Invalid answer regular expression.'),
    })
    .strict()

export const successCriterionSchema = z.union([
    flagField,
    flagJson,
    planJson,
    recordExists,
    answerIncludes,
    answerExcludes,
    answerMatches,
])

const fixtureSchema = z
    .object({
        key: z.string().startsWith('mcp-eval-'),
        present: z.boolean().default(true),
        flag: z
            .object({
                name: z.string(),
                active: z.boolean(),
                filters: z.record(z.string(), z.unknown()),
            })
            .strict(),
        plan: z.record(z.string(), z.unknown()).nullable().default(null),
    })
    .strict()

const taskSchema = z
    .object({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        category: z.literal('feature-flags'),
        intent: z.string().min(10),
        fixture: z.string().nullable(),
        expected_tools: z.array(z.string()).min(1),
        acceptable_tools: z.array(z.string()),
        forbidden_tools: z.array(z.string()),
        trace_assertions: z.array(traceAssertionSchema),
        success_criteria: z.array(successCriterionSchema),
        probe: z
            .object({
                tool: z.string(),
                arguments: z.record(z.string(), z.unknown()),
            })
            .strict()
            .nullable(),
    })
    .strict()

export const benchmarkSchema = z
    .object({
        version: z.literal('m7-v1'),
        fixtures: z.record(z.string(), fixtureSchema),
        tasks: z.array(taskSchema).min(12),
    })
    .strict()

export type Benchmark = z.infer<typeof benchmarkSchema>
export type BenchmarkTask = z.infer<typeof taskSchema>

export function loadBenchmark(repositoryRoot = findRepositoryRoot()): Benchmark {
    const filename = path.join(repositoryRoot, 'services/mcp/evals/benchmark/tasks.yaml')
    const benchmark = benchmarkSchema.parse(parseYaml(fs.readFileSync(filename, 'utf8')))
    const toolMap = new Map(getCatalog().tools.map((tool) => [tool.name, tool]))
    const ids = new Set<string>()
    const fixtureOwners = new Map<string, string>()
    for (const task of benchmark.tasks) {
        if (ids.has(task.id)) throw new Error(`Duplicate benchmark task ID ${task.id}.`)
        ids.add(task.id)
        const referencedTools = [
            ...task.expected_tools,
            ...task.acceptable_tools,
            ...task.forbidden_tools,
            ...task.trace_assertions.flatMap((assertion) =>
                'tool' in assertion
                    ? [assertion.tool]
                    : assertion.kind === 'tool-before'
                      ? [assertion.first, assertion.then]
                      : []
            ),
        ]
        for (const tool of referencedTools) {
            if (!toolMap.has(tool)) throw new Error(`Task ${task.id} references unknown tool ${tool}.`)
        }
        const allowed = new Set([...task.expected_tools, ...task.acceptable_tools])
        for (const forbidden of task.forbidden_tools) {
            if (allowed.has(forbidden)) throw new Error(`Task ${task.id} both allows and forbids ${forbidden}.`)
        }
        if (task.fixture) {
            if (!benchmark.fixtures[task.fixture]) throw new Error(`Task ${task.id} references unknown fixture.`)
            const mutates = task.expected_tools.some((tool) => !toolMap.get(tool)?.annotations.readOnly)
            if (mutates) {
                const owner = fixtureOwners.get(task.fixture)
                if (owner) throw new Error(`Mutating tasks ${owner} and ${task.id} share fixture ${task.fixture}.`)
                fixtureOwners.set(task.fixture, task.id)
            }
        }
        if (task.probe) {
            const tool = toolMap.get(task.probe.tool)
            if (!tool?.annotations.readOnly) throw new Error(`Task ${task.id} probe is not read-only.`)
        }
    }
    for (const fixture of Object.keys(benchmark.fixtures)) {
        const users = benchmark.tasks.filter((task) => task.fixture === fixture)
        if (users.length !== 1) throw new Error(`Fixture ${fixture} must belong to exactly one task.`)
    }
    return benchmark
}
