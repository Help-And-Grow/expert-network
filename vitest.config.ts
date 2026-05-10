/**
 * Vitest config for unit tests under src/.
 *
 * Tests live alongside the code they cover (e.g. src/lib/foo.test.ts).
 * Playwright e2e tests under e2e/ are excluded — they're run via the
 * `test:e2e` / `test:ui` scripts instead.
 *
 * The `tsconfigPaths` plugin lets tests import via the `@/` alias
 * the same way the runtime code does.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Vite 4+ resolves tsconfig `paths` (the `@/*` alias) natively.
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
    environment: "node",
    testTimeout: 10_000,
  },
});
