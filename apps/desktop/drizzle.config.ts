import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Drizzle-kit config for the todos feature database. Each feature owns its
 * own SQLite file and ships its migrations inside the feature directory
 * (Decision #20) — there is no shared shell database.
 */

/** @type {import("drizzle-kit").Config} */
export default {
	schema: "./src/main/features/todos/schema.ts",
	out: "./src/main/features/todos/drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".data/plugins/todos/data.db"),
	},
};
