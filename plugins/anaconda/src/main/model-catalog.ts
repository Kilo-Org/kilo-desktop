import type { KernelLogger } from "@kilo-desktop/kernel";
import type {
	ModelCatalogAccess,
	ModelCatalogSource,
} from "@kilo-desktop/plugin-local-inference/contracts";

import type { AnacondaAccountResult, AnacondaAccountSession } from "../contracts";
import type { AnacondaCredentialStore } from "./credentials/anaconda-credential-store";
import {
	getModelDownloadUrl,
	listModelCatalog,
	type ModelCatalogDependencies,
} from "./catalog/catalog-client";

/** The Anaconda site when the site config can't be read, as in origin. */
export const DEFAULT_ANACONDA_DOMAIN = "anaconda.com";

export interface AnacondaModelCatalogOptions {
	/** The account's session once resolved; undefined until then. */
	readonly session: () => AnacondaAccountSession | undefined;
	/** Resolves the session (lazily, once; later calls are cached). */
	readonly resolveSession: () => Promise<void>;
	/** Calls back on the first resolve and on every session or key change. */
	readonly subscribe: (onChange: () => void) => () => void;
	readonly fetch: typeof globalThis.fetch;
	readonly credentials: Pick<AnacondaCredentialStore, "getApiKey" | "getSiteDomain">;
	readonly logger: Pick<KernelLogger, "warn">;
	/** The account's browser sign-in, shared with the domain object. */
	readonly signIn: () => Promise<AnacondaAccountResult>;
	readonly cancelSignIn: () => void;
}

/**
 * Anaconda's model catalog as a `kilo.local-inference/model-catalog`
 * contribution: who it is read for follows the Anaconda account, and the
 * catalog and downloads are read with its API key from its site.
 */
export function createAnacondaModelCatalog(
	options: AnacondaModelCatalogOptions,
): ModelCatalogSource {
	const { credentials, logger } = options;
	const dependencies: ModelCatalogDependencies = {
		fetch: options.fetch,
		getApiKey: () =>
			credentials.getApiKey().catch((error: unknown) => {
				logger.warn(`Could not read the Anaconda API key: ${errorMessage(error)}`);
				return null;
			}),
		getSiteDomain: () => credentials.getSiteDomain().catch(() => DEFAULT_ANACONDA_DOMAIN),
	};
	return {
		access: () => catalogAccess(options.session()),
		resolveAccess: () => options.resolveSession(),
		subscribe: (onChange) => options.subscribe(onChange),
		list: () => listModelCatalog(dependencies),
		downloadUrl: (identity, signal) =>
			getModelDownloadUrl(dependencies, identity.modelId, identity.quantizationId, signal),
		signIn: () => options.signIn(),
		cancelSignIn: async () => options.cancelSignIn(),
	};
}

function catalogAccess(session: AnacondaAccountSession | undefined): ModelCatalogAccess {
	if (!session) return { status: "resolving" };
	switch (session.status) {
		case "anonymous":
			return { status: "signed-out" };
		case "authenticated":
			return { status: "signed-in", accountKey: session.user.userId ?? session.user.email ?? "" };
		case "error":
			return { status: "error", reason: session.reason };
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
