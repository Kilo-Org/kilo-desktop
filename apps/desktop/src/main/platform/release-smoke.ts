import { writeFile } from "node:fs/promises";

/**
 * Tells `config/smoke-release-artifact.ts` that the packaged app booted and
 * revealed its main window. The publish workflow fails without this file, so
 * keep the variable name in sync with that script.
 */
export async function signalReleaseSmokeReady(env: NodeJS.ProcessEnv): Promise<void> {
	if (env.CI !== "true") return;
	const readyFile = env.KILO_RELEASE_SMOKE_READY_FILE;
	if (readyFile) await writeFile(readyFile, "ready\n", { flag: "wx" });
}
