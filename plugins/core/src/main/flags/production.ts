import path from "node:path";

import { KernelApp, mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { ANONYMOUS_CONTEXT } from "./context";
import { DefaultsOnlyProvider } from "./defaults-provider";
import type { FlagsOptions } from "./index";
import { adoptEarlierCache } from "./cache-adoption";
import { LaunchDarklyProvider } from "./provider";
import type { FeatureFlagProvider } from "./types";

function launchDarkly(sdk: PluginSdk): FeatureFlagProvider {
	const clientSideId = import.meta.env.VITE_LAUNCHDARKLY_CLIENT_SIDE_ID ?? "";
	if (clientSideId) {
		// A fingerprint confirms which LaunchDarkly environment the app booted
		// against without writing the credential to log files.
		sdk.logger.info(
			`LaunchDarkly client-side ID configured (${clientSideId.slice(0, 4)}…${clientSideId.slice(-4)}).`,
		);
	} else {
		sdk.logger.warn(
			"No LaunchDarkly client-side ID configured (VITE_LAUNCHDARKLY_CLIENT_SIDE_ID); flags will resolve to defaults.",
		);
		return new DefaultsOnlyProvider();
	}
	const storageDir = mainHost(sdk).storage.dir;
	const storagePath = path.join(storageDir, "launchdarkly");
	try {
		adoptEarlierCache(
			[
				// kilo.flags' cache, beside kilo.core's folder.
				path.join(storageDir, "..", "kilo.flags", "launchdarkly"),
				// Origin kept it in the app's data folder, two levels above `plugins/<id>`.
				path.join(storageDir, "..", "..", "launchdarkly"),
			],
			storagePath,
		);
	} catch (error) {
		sdk.logger.warn(
			`Could not copy the earlier LaunchDarkly cache; flags start from defaults until it answers: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	return new LaunchDarklyProvider({
		clientSideId,
		initialContext: ANONYMOUS_CONTEXT,
		appVersion: sdk.domainObjects.get(KernelApp)?.getState().version ?? "0.0.0",
		storagePath,
		logger: sdk.logger,
	});
}

/** LaunchDarkly, configured from the build environment. */
export function productionFlagsOptions(sdk: PluginSdk): FlagsOptions {
	return { createProvider: () => launchDarkly(sdk) };
}
