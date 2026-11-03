import { readFileSync, rmSync, writeFileSync } from "node:fs";

/**
 * The contract between the app and `config/start-dev.ts` for relaunching in
 * development. `app.relaunch()` would start the new process outside Electron
 * Forge: Forge exits with the old process, `pnpm dev` then stops the renderer's
 * dev server, and the orphaned app has nothing to load. Under the launcher the
 * app writes its request to the file the launcher names, then quits; the
 * launcher starts Forge again. A file rather than an exit code, because Forge
 * exits 0 whatever code the app exits with.
 */
export const DEV_RELAUNCH_FILE_ENV = "KILO_DEV_RELAUNCH_FILE";

interface RelaunchRequest {
	readonly safeMode: boolean;
}

/** Leaves a relaunch request for the launcher; false when no launcher is waiting. */
export function requestDevRelaunch(
	safeMode: boolean,
	env: Readonly<Record<string, string | undefined>>,
): boolean {
	const file = env[DEV_RELAUNCH_FILE_ENV];
	if (!file) return false;
	writeFileSync(file, JSON.stringify({ safeMode } satisfies RelaunchRequest));
	return true;
}

/** The relaunch the app asked for before it exited (consuming it), or undefined when it quit. */
export function takeDevRelaunch(file: string): RelaunchRequest | undefined {
	let request: unknown;
	try {
		request = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
	rmSync(file, { force: true });
	const safeMode = (request as Partial<RelaunchRequest> | null)?.safeMode === true;
	return { safeMode };
}
