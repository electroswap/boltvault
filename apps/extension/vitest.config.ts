import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30000,
    // React must load its DEV build for @testing-library/react's `act`; a
    // production build throws "act(...) is not supported in production builds".
    env: { NODE_ENV: 'test' },
  },
})
