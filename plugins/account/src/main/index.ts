import { readFileSync } from "node:fs";
import path from "node:path";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { createAccountMainEntry } from "./account";
import { isE2eSignedIn, withE2eIdentity } from "./e2e-identity";
import { createKiloAccountClient } from "./kilo-client";

export { createAccountMainEntry } from "./account";

/**
 * Origin's kilo-ui kept the terms acceptance in its own kv folder, beside this
 * plugin's. Read synchronously: it is a tiny file, and the acceptance must be
 * known before `termsAccepted` first gates the Kilo server.
 */
function readOriginTerms(sdk: PluginSdk): string | null {
	try {
		return readFileSync(
			path.join(mainHost(sdk).storage.dir, "..", "kilo-ui", "terms-acceptance.json"),
			"utf8",
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** kilo.account's main-process entry, reading the account from the Kilo server. */
export const accountMainEntry = createAccountMainEntry({
	createClient: isE2eSignedIn()
		? (connection) => withE2eIdentity(createKiloAccountClient(connection))
		: createKiloAccountClient,
	readOriginTerms,
});
