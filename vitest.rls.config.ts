import { defineConfig } from "vitest/config";
import path from "node:path";

// Pruebas contra Supabase local (requieren `supabase start`).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/rls/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    fileParallelism: false,
  },
});
