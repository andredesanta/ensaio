import { defineConfig } from 'orval'

export default defineConfig({
    ensaio: {
        input: './openapi.json',
        output: {
            target: '../products/feature_flags/frontend/generated/api.ts',
            schemas: '../products/feature_flags/frontend/generated/models',
            client: 'fetch',
            mode: 'single',
            clean: true,
            override: {
                mutator: {
                    path: '../products/feature_flags/frontend/apiClient.ts',
                    name: 'apiClient',
                },
            },
        },
    },
})
