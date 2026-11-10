import { readFileSync } from "node:fs";
import path from "node:path";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { KILO_TERMS_VERSION } from "../../contracts";
import { isE2eSignedIn, withE2eIdentity } from "./e2e-identity";
import type { AccountOptions } from "./index";
import { createKiloAccountClient } from "./kilo-client";
import { inMemoryTerms, TermsRecord, type PersistedTerms, type TermsStorage } from "./terms";

/**
 * Read synchronously: tiny files, and the acceptance must be known before
 * `termsAccepted` first gates the Kilo server.
 */
function readIfPresent(file: string): string | null {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/**
 * Packaged e2e runs (`KILO_SKIP_ONBOARDING=1`) treat the current terms as
 * accepted in memory, so the gate stays out of the way without touching the
 * profile.
 */
function termsStorage(sdk: PluginSdk): TermsStorage {
	if (process.env["KILO_SKIP_ONBOARDING"] === "1") {
		return inMemoryTerms({ version: KILO_TERMS_VERSION, acceptedAt: 1, linkedAccounts: [] });
	}
	return mainHost(sdk).storage.kv<PersistedTerms>({
		namespace: "terms",
		defaults: TermsRecord.empty(),
	});
}

/** The account read from the real Kilo server, with terms kept in kilo.core's storage. */
export function productionAccountOptions(sdk: PluginSdk): AccountOptions {
	const plugins = path.join(mainHost(sdk).storage.dir, "..");
	return {
		createClient: isE2eSignedIn()
			? (connection) => withE2eIdentity(createKiloAccountClient(connection))
			: createKiloAccountClient,
		termsStorage: termsStorage(sdk),
		predecessorTerms: [
			// kilo.account's kv namespace `terms`.
			() => readIfPresent(path.join(plugins, "kilo.account", "terms.json")),
			// Origin's kilo-ui, which kilo.account itself adopted from.
			() => readIfPresent(path.join(plugins, "kilo-ui", "terms-acceptance.json")),
		],
	};
}
