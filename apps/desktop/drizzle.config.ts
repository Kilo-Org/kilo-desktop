import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/main/features/workspaces/schema.ts",
	out: "./drizzle/workspaces",
});
