import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: "startup.spec.ts",
	timeout: 30_000,
	workers: 1,
});
