import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import("drizzle-kit").Config} */
export default {
	schema: "./src/main/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".data/data.db"),
	},
};
