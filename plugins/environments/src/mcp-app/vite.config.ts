import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
	root: __dirname,
	build: {
		outDir: "dist",
		// The renderer imports dist/index.html (src/web/mcp-app.ts), and `pnpm dev`
		// rebuilds it (desktop prestart) while the web dev server is already
		// serving: emptying the folder would delete the file under it. The single
		// file build overwrites index.html in place instead.
		emptyOutDir: false,
		target: "esnext",
	},
	resolve: {
		// Ensure all @modelcontextprotocol packages resolve from the workspace root
		dedupe: [
			"@modelcontextprotocol/client",
			"@modelcontextprotocol/core",
			"@modelcontextprotocol/ext-apps",
		],
	},
	plugins: [viteSingleFile()],
});
