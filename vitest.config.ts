import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: [],
    // Certains tests importent à froid tout le graphe (Anthropic SDK, Mongoose,
    // Satori, resvg) — la 1re assertion d'un fichier peut prendre ~5–8s.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
