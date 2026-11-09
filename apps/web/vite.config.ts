import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, type Plugin } from "vite";

import {
	accentCss,
	ACCENTS,
	APP_THEMES,
	DEFAULT_APP_THEME_PREFERENCES,
	themeCss,
} from "../../packages/ui/src/themes/app-themes";
import {
	criticalThemeStyle,
	themeBootstrapScript,
} from "../../packages/ui/src/themes/theme-tokens";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(root, "src");
const uploadSourcemaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

function injectThemeBootstrap(): Plugin {
	return {
		name: "inject-theme-bootstrap",
		transformIndexHtml() {
			const themes = Object.fromEntries(
				APP_THEMES.map(({ id }) => [id, themeCss({ themeId: id, accentId: "theme" })]),
			);
			return [
				{ tag: "style", children: criticalThemeStyle(), injectTo: "head-prepend" },
				{
					tag: "script",
					children: themeBootstrapScript(
						DEFAULT_APP_THEME_PREFERENCES.themeId,
						themes,
						Object.fromEntries(ACCENTS.map(({ id }) => [id, accentCss(id)])),
					),
					injectTo: "head-prepend",
				},
			];
		},
	};
}

export default defineConfig({
	base: "./",
	plugins: [
		react(),
		tailwindcss(),
		injectThemeBootstrap(),
		sentryVitePlugin({
			authToken: process.env.SENTRY_AUTH_TOKEN,
			...(process.env.SENTRY_ORG && { org: process.env.SENTRY_ORG }),
			project: process.env.SENTRY_PROJECT ?? "kilo-desktop",
			...(uploadSourcemaps && {
				// Absolute and rooted at `dist/`: Sentry resolves a relative glob
				// against the process cwd, so a bare `**/*.map` would sweep the
				// whole repo if the build ever ran from the root. Forward slashes
				// because glob treats `\` as an escape on Windows hosts.
				sourcemaps: {
					filesToDeleteAfterUpload: [`${root.replaceAll("\\", "/")}/dist/**/*.map`],
				},
			}),
		}),
	],
	assetsInclude: ["**/*.lottie"],
	resolve: {
		alias: {
			"@": srcRoot,
		},
		// Linked plugin sources import these packages from their own module graph.
		// Keep provider and consumer imports on one React/context instance.
		dedupe: ["react", "react-dom", "@kilo-desktop/kernel"],
	},
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
		// The desktop shell loads the renderer over the custom
		// `kilo-desktop-dev://app` scheme, so Vite's HMR client would
		// otherwise derive a bogus `ws://app/` socket URL (ERR_NAME_NOT_RESOLVED).
		// Pin the client to the real dev server so HMR connects directly.
		hmr: {
			protocol: "ws",
			host: "127.0.0.1",
			clientPort: 5173,
		},
	},
	build: {
		// Only emit maps when they will be uploaded and stripped
		// (filesToDeleteAfterUpload). Without the token, emitting maps would ship
		// raw `.map` files with no upload and no cleanup.
		sourcemap: uploadSourcemaps,
		outDir: "dist",
		emptyOutDir: true,
		// Read by the desktop packager to write the app's third-party notices.
		license: { fileName: ".vite/licenses.json" },
	},
});
