/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: {
                    esModuleInterop: true,
                    strict: true,
                    jsx: 'react-jsx',
                    module: 'commonjs',
                    // TypeScript 6 retired the old `node` resolution (now called `node10`).
                    // `bundler` is what the Vite app uses; Jest still emits CommonJS.
                    moduleResolution: 'bundler',
                    ignoreDeprecations: '6.0',
                    verbatimModuleSyntax: false,
                    isolatedModules: true,
                    types: ['jest'],
                },
            },
        ],
    },
}
