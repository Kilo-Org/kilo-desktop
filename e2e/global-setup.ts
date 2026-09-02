import { buildPackagedApp } from "./utils/app-launcher.js";

/**
 * Package outside the first test's timeout. `package:e2e` regularly exceeds
 * the 6-minute test budget locally (native build + pnpm deploy), which
 * killed the worker mid-build (`write EPIPE`) and left leftover build dirs.
 */
export default async function globalSetup(): Promise<void> {
	if (process.env.SKIP_BUILD === "true") return;
	await buildPackagedApp();
}
