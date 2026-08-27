import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
	root: __dirname,
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "esnext",
	},
	resolve: {
		// Ensure all @modelcontextprotocol packages resolve from the workspace root
		dedupe: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/ext-apps"],
	},
	plugins: [viteSingleFile()],
});
