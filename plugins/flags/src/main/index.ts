import path from "node:path";

import {
	definePlugin,
	isLocalName,
	KernelApp,
	KernelService,
	mainHost,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import { Flags } from "../contracts";
import { DefaultsOnlyProvider } from "./defaults-provider";
import { LaunchDarklyProvider } from "./provider";
import { Identity } from "@kilo-desktop/plugin-account/contracts";

import { ANONYMOUS_CONTEXT, contextFor } from "./identity";
import { adoptOriginCache } from "./origin-cache";
import { FeatureFlagService, parseOverrides, type FlagMap } from "./service";
import type { FeatureFlagProvider } from "./types";

export interface FlagsMainOptions {
	readonly createProvider: (sdk: PluginSdk) => FeatureFlagProvider;
	/** Comma-separated flags forced on. */
	readonly overrides?: string | undefined;
}

/**
 * kilo.flags in main: publishes flags through the Flags domain object and as
 * `flag:<key>` context keys. LaunchDarkly runs as a supervised daemon so the
 * kernel shows it in Diagnostics and closes it on quit; until it answers,
 * flags read from its cache (or are empty) and `ready` is false.
 */
export function createFlagsMainEntry(options: FlagsMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const service = new FeatureFlagService({
				provider: options.createProvider(sdk),
				overrides: parseOverrides(options.overrides),
				logger: sdk.logger,
			});
			let ready = false;
			const flagsOn = new Set<string>();
			const flags = sdk.domains.provide(Flags, {
				initialState: { flags: service.getAllFlags(), ready },
				methods: {},
			});
			const publish = (all: FlagMap) => {
				flags.setState({ flags: all, ready });
				syncContextKeys(sdk, all, flagsOn);
			};
			syncContextKeys(sdk, flags.state.flags, flagsOn);
			sdk.onDispose(service.onChange(publish));

			// Flags follow the signed-in Kilo account when kilo.account is installed.
			let started = false;
			let context = contextFor(sdk.domains.get(Identity)?.getState());
			const stopIdentity = sdk.domains.get(Identity)?.subscribe((state) => {
				const next = contextFor(state);
				if (JSON.stringify(next) === JSON.stringify(context)) return;
				context = next;
				if (started) void service.identify(context);
			});
			if (stopIdentity) sdk.onDispose(stopIdentity);

			sdk.extensions.implement(KernelService, "launchdarkly", {
				start: async () => {
					await service.identify(context);
					started = true;
					ready = true;
					publish(service.getAllFlags());
				},
				stop: () => service.dispose(),
			});
		},
	});
}

/** Keeps `flag:<key>` true exactly while that flag is `true`. */
function syncContextKeys(sdk: PluginSdk, all: FlagMap, flagsOn: Set<string>): void {
	const nowOn = new Set(
		Object.keys(all).filter((key) => all[key] === true && isLocalName(`flag:${key}`)),
	);
	for (const key of flagsOn) if (!nowOn.has(key)) sdk.context.set(`flag:${key}`, false);
	for (const key of nowOn) if (!flagsOn.has(key)) sdk.context.set(`flag:${key}`, true);
	flagsOn.clear();
	for (const key of nowOn) flagsOn.add(key);
}

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
	const storagePath = path.join(mainHost(sdk).storage.dir, "launchdarkly");
	// Origin kept the cache in the app's data folder, two levels above `plugins/<id>`.
	const originCache = path.join(mainHost(sdk).storage.dir, "..", "..", "launchdarkly");
	try {
		adoptOriginCache(originCache, storagePath);
	} catch (error) {
		sdk.logger.warn(
			`Could not copy origin's LaunchDarkly cache; flags start from defaults until it answers: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	return new LaunchDarklyProvider({
		clientSideId,
		initialContext: ANONYMOUS_CONTEXT,
		appVersion: sdk.domains.get(KernelApp)?.getState().version ?? "0.0.0",
		storagePath,
		logger: sdk.logger,
	});
}

/** kilo.flags' main-process entry, configured from the build environment. */
export const flagsMainEntry = createFlagsMainEntry({
	createProvider: launchDarkly,
	overrides: import.meta.env.VITE_FEATURE_FLAG_OVERRIDES,
});
