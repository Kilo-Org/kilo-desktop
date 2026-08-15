import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { externalizeDeps } from "vite-plugin-externalize-deps";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		// Mirror the main build: externalize runtime dependencies and Node
		// built-ins rather than hand-listing them. `electron` is a devDependency
		// (not in `dependencies`), so it is added via `include`.
		externalizeDeps({
			useFile: path.resolve(root, "package.json"),
			include: ["electron"],
			// Workspace-internal packages must stay bundled into the preload output.
			except: [/^@anaconda-agentic-desktop\/(?:.+)?$/],
		}),
	],
});
