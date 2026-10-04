import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config.js'

const valid = {
    ENSAIO_BASE_URL: 'http://127.0.0.1:8000/',
    ENSAIO_PROJECT_ID: '7',
    ENSAIO_API_TOKEN: 'ens_pat_FAKE_SELECTOR.FAKE_SECRET',
}

describe('loadConfig', () => {
    it('normalizes a valid loopback configuration', () => {
        expect(loadConfig(valid)).toEqual({
            baseUrl: 'http://127.0.0.1:8000',
            projectId: 7,
            apiToken: valid.ENSAIO_API_TOKEN,
            timeoutMs: 10_000,
        })
        expect(loadConfig({ ...valid, ENSAIO_BASE_URL: 'http://[::1]:8000' }).baseUrl).toBe('http://[::1]:8000')
    })

    it.each([
        [{ ...valid, ENSAIO_BASE_URL: '' }, 'ENSAIO_BASE_URL'],
        [{ ...valid, ENSAIO_BASE_URL: 'ftp://localhost' }, 'http or https'],
        [{ ...valid, ENSAIO_BASE_URL: 'http://example.com' }, 'loopback'],
        [{ ...valid, ENSAIO_PROJECT_ID: '0' }, 'positive integer'],
        [{ ...valid, ENSAIO_API_TOKEN: 'ens_sec_fake' }, 'ens_pat_'],
    ])('rejects invalid configuration without printing a token', (env, message) => {
        expect(() => loadConfig(env)).toThrow(message)
        try {
            loadConfig(env)
        } catch (error) {
            expect(String(error)).not.toContain(valid.ENSAIO_API_TOKEN)
        }
    })
})
