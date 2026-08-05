import { existsSync } from "node:fs";
import path from "node:path";

import { DAEMON_STAGING_DIRECTORY, daemonAssetName, daemonChannel } from "$config/daemon-asset.js";

/**
 * Locates the staged `runtimed` sidecar on disk.
 *
 * Packaged builds get it from `extraResource`, which lands it flat in
 * `Contents/Resources` (`process.resourcesPath`); an unpackaged run finds the
 * same file where the `prepare:daemon` script staged it. Electron values are
 * passed in rather than imported so this stays unit-testable, and because
 * `RuntimedService.ts` next door may not import electron at all.
 */
export interface DaemonBinaryPathOptions {
	readonly isPackaged: boolean;
	readonly resourcesPath: string;
	/** `app.getAppPath()` — the `apps/desktop` package root when unpackaged. */
	readonly appPath: string;
	readonly environment?: { readonly RUNT_BUILD_CHANNEL?: string | undefined };
	readonly platform?: NodeJS.Platform;
	readonly exists?: (candidate: string) => boolean;
}

/**
 * Returns the daemon path, or undefined when this build bundles none — not an
 * error: the app treats an unreachable daemon as an expected state, and may
 * still attach to a separately installed one.
 */
export function resolveDaemonBinaryPath(options: DaemonBinaryPathOptions): string | undefined {
	const exists = options.exists ?? existsSync;
	const assetName = daemonAssetName(
		daemonChannel(options.environment ?? process.env),
		options.platform ?? process.platform,
	);
	const candidate = options.isPackaged
		? path.join(options.resourcesPath, assetName)
		: path.join(options.appPath, DAEMON_STAGING_DIRECTORY, assetName);
	return exists(candidate) ? candidate : undefined;
}
