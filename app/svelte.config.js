import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/kit").Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		files: { src: "src/renderer" },
		adapter: adapter({
			pages: ".vite/renderer/main_window",
			assets: ".vite/renderer/main_window",
			strict: true,
		}),
		// content security policy
		// https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy
		csp: {
			directives: {
				"default-src": ["self"],
				"script-src": ["self"],
				"style-src": ["self", "unsafe-inline"],
				"img-src": ["self", "data:"],
			},
		},
	},
};

export default config;
