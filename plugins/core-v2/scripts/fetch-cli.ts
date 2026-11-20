/**
 * Stages the pinned Kilo CLI into this plugin's `resources/kilo/`.
 *
 * Windows signing is an optional host seam: when Azure Key Vault env vars are
 * set, we load `apps/desktop/config/windows-sign.js` from the monorepo root
 * without taking a package dependency on the desktop app.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { KILO_CLI_VERSION, stageKiloCli } from "../src/main/agent/cli-distribution/index.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(pluginRoot, "../..");
const resourceRoot = path.join(pluginRoot, "resources/kilo");

async function maybeWindowsSignExecutable(): Promise<
	((executablePath: string) => Promise<void>) | undefined
> {
	const vaultUri = process.env.AZURE_KEY_VAULT_URI?.trim();
	const certName = process.env.AZURE_CERT_NAME?.trim();
	if (!vaultUri || !certName) {
		return undefined;
	}

	const windowsSignModuleUrl = pathToFileURL(
		path.join(workspaceRoot, "apps/desktop/config/windows-sign.js"),
	).href;
	// Dynamic import: optional host signing callback; not a plugin dependency.
	const windowsSign = (await import(windowsSignModuleUrl)) as {
		signWindowsFile: (filePath: string) => Promise<void>;
	};
	return windowsSign.signWindowsFile;
}

const signExecutable = await maybeWindowsSignExecutable();
const result = await stageKiloCli({
	resourceRoot,
	...(signExecutable ? { signExecutable } : {}),
});

console.log(
	result.staged
		? `Staged ${result.artifact.packageName}@${KILO_CLI_VERSION} for ${result.artifact.target}.`
		: `Kilo CLI ${KILO_CLI_VERSION} is already staged for ${result.artifact.target}.`,
);
