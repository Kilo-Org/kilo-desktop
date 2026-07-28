import path from "node:path";

/** Development origin for the standalone web Vite server (proxied by the custom protocol). */
export function getWebDevServerUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.ANACONDA_WEB_DEV_SERVER_URL?.trim();
	return value || undefined;
}

/** Packaged renderer assets are staged at `.vite/renderer/main_window` next to the main bundle. */
export function getProductionRendererRoot(mainDirectory: string): string {
	return path.join(mainDirectory, "../renderer/main_window");
}
