import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "react-opencode",
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
