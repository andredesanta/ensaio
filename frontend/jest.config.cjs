/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/src', '<rootDir>/../products/feature_flags/frontend'],
    testMatch: [
        '<rootDir>/src/**/*.test.ts',
        '<rootDir>/src/**/*.test.tsx',
        '<rootDir>/../products/feature_flags/frontend/**/*.test.ts',
        '<rootDir>/../products/feature_flags/frontend/**/*.test.tsx',
    ],
    moduleNameMapper: {
        '^kea$': '<rootDir>/node_modules/kea',
        '^kea-forms$': '<rootDir>/node_modules/kea-forms',
        '^kea-loaders$': '<rootDir>/node_modules/kea-loaders',
        '^kea-router$': '<rootDir>/node_modules/kea-router',
        '^kea-test-utils$': '<rootDir>/node_modules/kea-test-utils',
    },
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
