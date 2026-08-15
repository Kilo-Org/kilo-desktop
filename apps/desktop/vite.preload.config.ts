import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { externalizeDeps } from "@anaconda-agentic-desktop/vite-plugin-externalize-deps";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		externalizeDeps({
			packageJsonPath: path.resolve(root, "package.json"),
			// `electron` is a devDependency, so it is added via `include`.
			include: ["electron"],
			// Workspace packages are `workspace:*` / `link:` deps that must stay bundled.
			exclude: [/^@anaconda-agentic-desktop\/.+$/],
		}),
	],
});
