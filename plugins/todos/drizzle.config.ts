import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Drizzle-kit config for the todos plugin database. Each plugin owns its own
 * SQLite file and ships its migrations inside the plugin package
 * (Decision #20) — there is no shared shell database.
 *
 * Run `pnpm --filter @anaconda-agentic-desktop/plugin-todos db:generate`
 * after changing src/main/schema.ts.
 */

/** @type {import("drizzle-kit").Config} */
export default {
	schema: "./src/main/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".data/data.db"),
	},
};
