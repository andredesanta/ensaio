import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { getCatalog } from './tools/catalog.js'

export const ROLLOUT_SKILL_NAME = 'managing-health-gated-rollouts'
export const ROLLOUT_SKILL_URI = `ensaio://skills/${ROLLOUT_SKILL_NAME}`

const frontmatterSchema = z
    .object({
        name: z.literal(ROLLOUT_SKILL_NAME),
        description: z.string().min(40).max(300),
    })
    .strict()

export type ValidatedSkill = {
    name: string
    description: string
    uri: string
    content: string
    sourcePath: string
}

export function findRepositoryRoot(start = path.dirname(fileURLToPath(import.meta.url))): string {
    let current = path.resolve(start)
    for (;;) {
        if (
            fs.existsSync(path.join(current, 'frontend/openapi.json')) &&
            fs.existsSync(path.join(current, 'products/feature_flags'))
        ) {
            return current
        }
        const parent = path.dirname(current)
        if (parent === current) throw new Error('Could not locate the Ensaio repository root.')
        current = parent
    }
}

export function loadRolloutSkill(repositoryRoot = findRepositoryRoot()): ValidatedSkill {
    const sourcePath = path.join(repositoryRoot, 'products/feature_flags/skills', ROLLOUT_SKILL_NAME, 'SKILL.md')
    const content = fs.readFileSync(sourcePath, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > 12_000) {
        throw new Error('Rollout skill exceeds the 12 KB publication limit.')
    }
    const match = /^---\n([\s\S]+?)\n---\n/.exec(content)
    if (!match?.[1]) throw new Error('Rollout skill must begin with YAML frontmatter.')
    const frontmatter = frontmatterSchema.parse(parseYaml(match[1]))
    const knownTools = new Set(getCatalog().tools.map((tool) => tool.name))
    for (const reference of content.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)) {
        const name = reference[1]
        if (name?.includes('feature-flag') || name?.includes('rollout-plan') || name?.includes('guardrail-sample')) {
            if (!knownTools.has(name)) throw new Error(`Rollout skill references unknown tool ${name}.`)
        }
    }
    return {
        name: frontmatter.name,
        description: frontmatter.description,
        uri: ROLLOUT_SKILL_URI,
        content,
        sourcePath,
    }
}
