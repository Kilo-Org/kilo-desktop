// Boots kilo.anaconda's main entry on a real main kernel (and a window), with
// stand-ins under the real manifests: kilo.shell and kilo.local-inference
// (their points; kilo.local-inference's sdk is kept to call the account as
// it), a telemetry sink recording what is sent (with consent unless told
// otherwise) and a stranger plugin. The keyring, the browser step of the
// sign-in and Anaconda's server are fakes. kilo.shell and kilo.local-inference
// can be left out to check kilo.anaconda works without them.
import { vi } from "vitest";

import {
	definePlugin,
	KernelDataCollection,
	KernelOs,
	KernelTelemetrySink,
	type KernelLogger,
	type PluginEntry,
	type PluginRegistration,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import type { MainKernel } from "@kilo-desktop/kernel/main";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
	testPlugin,
} from "@kilo-desktop/kernel/testing";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import {
	LOCAL_INFERENCE_DEFINITIONS,
	ModelCatalogPoint,
} from "@kilo-desktop/plugin-local-inference/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";

import manifest from "../../plugin.json";
import {
	ANACONDA_DEFINITIONS,
	ANACONDA_MODEL_CATALOG,
	ANACONDA_PLUGIN_ID,
	AnacondaAccount,
	LOCAL_MODEL_CATALOG_FLAG,
	type AnacondaAccountSession,
} from "../contracts";
import type { ApiKeyExchanger, OAuthLogin } from "./AnacondaAccountService";
import { createAnacondaMainEntry, type AnacondaMainOptions } from "./entry";
import { OAuthCancelledError } from "./oauth/errors";
import type { LoopbackAuthorizer } from "./oauth/types";

export const WAIT = { timeout: 5_000 };

export const SIGNED_IN: AnacondaAccountSession = {
	status: "authenticated",
	user: { userId: "u1", email: "ada@anaconda.com" },
};

export const whoami = () =>
	new Response(
		JSON.stringify({ passport: { user_id: "u1", profile: { email: "ada@anaconda.com" } } }),
		{ status: 200, headers: { "content-type": "application/json" } },
	);

export function fakeCredentials(initialKey: string | null) {
	let apiKey = initialKey;
	return {
		getApiKey: vi.fn(async () => apiKey),
		getSiteDomain: vi.fn(async () => "anaconda.test"),
		getOAuthSettings: vi.fn(async () => ({ domain: "anaconda.test", clientId: "client" })),
		saveApiKey: vi.fn(async (key: string) => {
			apiKey = key;
		}),
		deleteApiKey: vi.fn(async () => {
			apiKey = null;
		}),
	};
}

/** A loopback authorizer whose browser step the test finishes or cancels. */
function fakeAuthorizer() {
	let finish: (url: string) => void = () => {};
	let fail: (error: Error) => void = () => {};
	const authorizer: LoopbackAuthorizer = {
		redirectUrl: "http://127.0.0.1:8000/auth/oidc",
		authorize: () =>
			new Promise<string>((resolve, reject) => {
				finish = resolve;
				fail = reject;
			}),
		close: vi.fn(),
		reopen: vi.fn(async () => true),
		cancel: vi.fn(() => fail(new OAuthCancelledError())),
	};
	return {
		authorizer,
		complete: () => finish("http://127.0.0.1:8000/auth/oidc?code=c"),
	};
}

/** Keeps the sdk a plugin activates with, to call the account as that plugin. */
function capturing(entry?: PluginEntry) {
	let sdk: PluginSdk | undefined;
	return {
		entry: definePlugin({
			activate(pluginSdk) {
				sdk = pluginSdk;
				return entry?.activate(pluginSdk);
			},
		}),
		account: () => sdk!.domainObjects.get(AnacondaAccount)!,
	};
}

/** Stands in for another plugin, capturing its sdk to call the account as that plugin. */
function callerPlugin(id: string) {
	const caller = capturing();
	const registration = testPlugin(id, {
		manifest: { requires: { [AnacondaAccount.id]: "optional" } },
		entry: caller.entry,
	});
	return { registration, account: caller.account };
}

const kernels: MainKernel[] = [];

/** Stops every kernel booted since the last call (an `afterEach`). */
export async function stopAnacondaMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((main) => main.stop()));
}

export interface BootOptions {
	readonly apiKey?: string | null;
	readonly login?: OAuthLogin;
	readonly exchangeForApiKey?: ApiKeyExchanger;
	readonly fetch?: typeof globalThis.fetch;
	/** Consent to collect usage data (default true). */
	readonly consent?: boolean;
	readonly withoutShell?: boolean;
	readonly withoutLocalInference?: boolean;
	readonly logger?: KernelLogger;
}

/** kilo.anaconda's main entry with its stand-ins, and a window. */
export async function bootAnacondaMain(options: BootOptions = {}) {
	const credentials = fakeCredentials(options.apiKey ?? null);
	const authorize = fakeAuthorizer();
	const login = vi.fn<OAuthLogin>(
		options.login ??
			(async (_config, deps) => {
				await deps.authorize("https://anaconda.test/authorize?state=s");
				return { access_token: "token", token_type: "bearer", raw: {} as never };
			}),
	);
	const tracked: { event: string; data: Readonly<Record<string, unknown>> }[] = [];
	const openExternal = vi.fn(() => true);
	const focusMain = vi.fn();
	const fetch = vi.fn<typeof globalThis.fetch>(options.fetch ?? (async () => whoami()));
	const entryOptions: AnacondaMainOptions = {
		credentials: () => credentials,
		service: {
			login,
			createAuthorizeServer: async () => authorize.authorizer,
			exchangeForApiKey: options.exchangeForApiKey ?? (async () => "new-key"),
		},
	};
	const anaconda = capturing(createAnacondaMainEntry(entryOptions));
	const windowAnaconda = capturing();
	const localInference = capturing();
	const stranger = callerPlugin("acme.stranger");
	const telemetrySink = testPlugin("test.telemetry-sink", {
		manifest: { contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } } },
		entry: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: ({ name, data }) => void tracked.push({ event: name, data }),
				});
			},
		}),
	});
	const shell: PluginRegistration = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const localInferenceDeclared: PluginRegistration = {
		manifest: localInferenceManifest,
		definitions: LOCAL_INFERENCE_DEFINITIONS,
	};
	const { main } = await createTestKernelPair({
		host: createTestHost({
			flagOverrides: { [LOCAL_MODEL_CATALOG_FLAG]: true },
			windows: {
				open: async () => "w",
				focus: () => {},
				close: () => {},
				setHidden: () => {},
				focusMain,
			},
		}),
		main: [
			...(options.withoutShell ? [] : [shell]),
			...(options.withoutLocalInference
				? []
				: [{ ...localInferenceDeclared, entry: localInference.entry }]),
			telemetrySink,
			{ manifest, definitions: ANACONDA_DEFINITIONS, entry: anaconda.entry },
			stranger.registration,
		],
		renderer: [
			...(options.withoutShell ? [] : [shell]),
			...(options.withoutLocalInference ? [] : [localInferenceDeclared]),
			{ manifest, definitions: ANACONDA_DEFINITIONS, entry: windowAnaconda.entry },
		],
		mainHostServices: (pluginId) => ({
			storage: createMemoryStorage(`/memory/${pluginId}`),
			net: { fetch },
		}),
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(main);
	main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal,
			showItemInFolder: () => {},
			showLogs: () => ({ revealed: true }),
			logFilePath: () => "/logs/main.log",
		},
	});
	const consent = options.consent ?? true;
	main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: consent, allowed: consent, installationId: "i", environment: "test" },
		methods: { setChoice: () => {} },
	});
	await main.flush();

	const account = main.kernelSdk.domainObjects.get(AnacondaAccount)!;
	const catalogContribution = () =>
		main.kernelSdk.extensions
			.list(ModelCatalogPoint)
			.find((candidate) => candidate.key === `${ANACONDA_PLUGIN_ID}/${ANACONDA_MODEL_CATALOG}`);
	return {
		main,
		account,
		credentials,
		authorize,
		login,
		tracked,
		/** The names of the events sent, in order. */
		events: () => tracked.map(({ event }) => event),
		openExternal,
		focusMain,
		fetch,
		/** The account as kilo.anaconda itself, in main. */
		ownAccount: anaconda.account,
		/** The account as kilo.anaconda's window entry. */
		windowAccount: windowAnaconda.account,
		localInferenceAccount: localInference.account,
		strangerAccount: stranger.account,
		catalogContribution,
		catalog: () => catalogContribution()!.implementation!,
	};
}

/** A logger recording warnings and errors. */
export function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}
