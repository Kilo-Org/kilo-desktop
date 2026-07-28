import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$config: path.resolve(root, "config"),
		},
	},
	test: {
		include: ["config/**/*.test.ts", "src/**/*.test.ts"],
		environment: "node",
	},
});
