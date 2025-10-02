import { defineConfig, defineWorkspace } from 'vitest/config';

// Define workspace with multiple environments
export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'dist/**', 'examples/**', '**/*.test.ts', '**/*.d.ts'],
    },
    // Define projects for different environments
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.test.ts', '**/*.test.tsx'],
        },
      },
      {
        test: {
          name: 'edge',
          environment: 'edge-runtime',
          include: ['**/*.test.ts', '**/*.test.tsx'],
        },
      },
    ],
  },
});
