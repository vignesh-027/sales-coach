import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_rzlocwedyqkwkiknnmfu",
  runtime: "node-22",
  logLevel: "log",
  maxDuration: 1200, // 20 min hard cap on a single run
  dirs: ["./worker"],
});
