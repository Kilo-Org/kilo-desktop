import { readFileSync } from "node:fs";
import path from "node:path";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { assetResources } from "./asset-resources";
import { createShellMainEntry } from "./entry";

export { createShellMainEntry, type ShellMainOptions } from "./entry";
export type { LegalResources } from "./legal";

/** Origin's kilo-ui kept the onboarding outcome in its own kv folder, beside this plugin's. */
function readOriginOnboarding(sdk: PluginSdk): string | null {
	try {
		return readFileSync(
			path.join(mainHost(sdk).storage.dir, "..", "kilo-ui", "onboarding.json"),
			"utf8",
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** kilo.shell's main-process entry. */
export const shellMainEntry = createShellMainEntry({
	readOriginOnboarding,
	legalResources: (sdk) => assetResources(mainHost(sdk).assets),
});
