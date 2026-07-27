import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Alias "@/..." aligné sur jsconfig.json pour que les modules lib/ (qui
// s'importent entre eux via "@/lib/...") se résolvent dans les tests.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
  },
});
