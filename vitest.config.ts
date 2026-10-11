import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/{run,ui,tracker,jev,unfamiliar,sites,entrypoints}.mjs"],
    environment: "node",
    // Fixture suites build full jsdom pages and can take several seconds each.
    testTimeout: 60_000,
  },
});
