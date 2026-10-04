import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { generateArtifacts } from '../scripts/generate-tools.js'
import { findRepositoryRoot, loadRolloutSkill } from '../src/skill.js'

describe('deterministic generation', () => {
    it('matches both committed generated artifacts byte-for-byte', () => {
        const root = findRepositoryRoot()
        const generated = generateArtifacts()

        expect(fs.readFileSync(path.join(root, 'services/mcp/src/tools/generated.ts'), 'utf8')).toBe(
            generated.generated
        )
        expect(fs.readFileSync(path.join(root, 'services/mcp/schema/tool-catalog.json'), 'utf8')).toBe(
            generated.catalog
        )
    })

    it('validates the product-owned rollout skill and its tool references', () => {
        const skill = loadRolloutSkill()
        expect(skill.name).toBe('managing-health-gated-rollouts')
        expect(skill.content).toMatch(/version\s+conflict/)
        expect(skill.content).toContain('Never invent a measurement')
    })
})
