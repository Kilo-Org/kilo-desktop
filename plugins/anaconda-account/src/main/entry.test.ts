import { afterEach, describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	KernelOs,
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
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { Telemetry, TELEMETRY_DEFINITIONS } from "@kilo-desktop/plugin-telemetry/contracts";

import manifest from "../../plugin.json";
import {
	ANACONDA_ACCOUNT_DEFINITIONS,
	AnacondaAccount,
	type AnacondaAccountSession,
} from "../contracts/index.js";
import type { ApiKeyExchanger, OAuthLogin } from "./AnacondaAccountService.js";
import { createAnacondaAccountMainEntry, type AnacondaAccountMainOptions } from "./entry.js";
import { OAuthCancelledError } from "./oauth/errors.js";
import type { LoopbackAuthorizer } from "./oauth/types.js";

const WAIT = { timeout: 5_000 };
const SIGNED_IN: AnacondaAccountSession = {
	status: "authenticated",
	user: { userId: "u1", email: "ada@anaconda.com" },
};

const whoami = () =>
	new Response(
		JSON.stringify({ passport: { user_id: "u1", profile: { email: "ada@anaconda.com" } } }),
		{ status: 200, headers: { "content-type": "application/json" } },
	);

function fakeCredentials(initialKey: string | null) {
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

/** Stands in for another plugin, capturing its sdk to call the account as that plugin. */
function callerPlugin(id: string) {
	let sdk: PluginSdk | undefined;
	const registration = testPlugin(id, {
		manifest: { requires: { "kilo.anaconda-account/account": "optional" } },
		entry: definePlugin({
			activate(pluginSdk) {
				sdk = pluginSdk;
			},
		}),
	});
	return { registration, account: () => sdk!.domains.get(AnacondaAccount)! };
}

const kernels: MainKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((main) => main.stop()));
});

async function boot(
	options: {
		apiKey?: string | null;
		login?: OAuthLogin;
		exchangeForApiKey?: ApiKeyExchanger;
		fetch?: typeof globalThis.fetch;
	} = {},
) {
	const credentials = fakeCredentials(options.apiKey ?? null);
	const authorize = fakeAuthorizer();
	const login = vi.fn<OAuthLogin>(
		options.login ??
			(async (_config, deps) => {
				await deps.authorize("https://anaconda.test/authorize?state=s");
				return { access_token: "token", token_type: "bearer", raw: {} as never };
			}),
	);
	const tracked = vi.fn<(event: string) => void>();
	const openExternal = vi.fn(() => true);
	const focusMain = vi.fn();
	const fetch = vi.fn(options.fetch ?? (async () => whoami()));
	const localInference = callerPlugin("kilo.local-inference");
	const windowLocalInference = callerPlugin("kilo.local-inference");
	const stranger = callerPlugin("acme.stranger");
	const entryOptions: AnacondaAccountMainOptions = {
		credentials: () => credentials,
		service: {
			login,
			createAuthorizeServer: async () => authorize.authorizer,
			exchangeForApiKey: options.exchangeForApiKey ?? (async () => "new-key"),
		},
	};
	const registrations: PluginRegistration[] = [
		{
			manifest: telemetryManifest,
			definitions: TELEMETRY_DEFINITIONS,
			entry: definePlugin({
				activate(sdk) {
					sdk.domains.provide(Telemetry, {
						initialState: {},
						methods: { track: ({ event }) => void tracked(event) },
					});
				},
			}),
		},
		{
			manifest,
			definitions: ANACONDA_ACCOUNT_DEFINITIONS,
			entry: createAnacondaAccountMainEntry(entryOptions),
		},
		localInference.registration,
		stranger.registration,
	];
	const { main } = await createTestKernelPair({
		host: createTestHost({
			windows: {
				open: async () => "w",
				focus: () => {},
				close: () => {},
				setHidden: () => {},
				focusMain,
			},
		}),
		main: registrations,
		renderer: [
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS },
			{ manifest, definitions: ANACONDA_ACCOUNT_DEFINITIONS },
			windowLocalInference.registration,
		],
		mainHostServices: (pluginId) => ({
			storage: createMemoryStorage(`/memory/${pluginId}`),
			net: { fetch: fetch as typeof globalThis.fetch },
		}),
	});
	kernels.push(main);
	main.kernelSdk.domains.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal,
			showItemInFolder: () => {},
			showLogs: () => ({ revealed: true }),
			logFilePath: () => "/logs/main.log",
		},
	});
	const account = main.kernelSdk.domains.get(AnacondaAccount)!;
	return {
		account,
		credentials,
		authorize,
		login,
		tracked,
		focusMain,
		fetch,
		localInference,
		windowLocalInference,
		stranger,
	};
}

describe("kilo.anaconda-account in main", () => {
	it("starts anonymous and resolves the session only when asked", async () => {
		const host = await boot({ apiKey: "stored-key" });

		expect(host.account.getState()).toEqual({
			session: { status: "anonymous" },
			signingIn: false,
		});
		expect(host.fetch).not.toHaveBeenCalled();

		await expect(host.account.methods.session(undefined)).resolves.toEqual(SIGNED_IN);
		expect(host.fetch).toHaveBeenCalledWith(
			"https://anaconda.test/api/auth/sessions/whoami",
			expect.objectContaining({ headers: { Authorization: "Bearer stored-key" } }),
		);
		expect(host.account.getState().session).toEqual(SIGNED_IN);
	});

	it("adopts the key origin left in the Anaconda keyring, so a signed-in user stays signed in", async () => {
		const host = await boot({ apiKey: "origin-key" });

		await expect(host.account.methods.refresh(undefined)).resolves.toEqual(SIGNED_IN);
		await expect(host.localInference.account().methods.apiKey(undefined)).resolves.toBe(
			"origin-key",
		);
	});

	it("gives the API key to kilo.local-inference and refuses other plugins", async () => {
		const host = await boot({ apiKey: "secret" });

		await expect(host.localInference.account().methods.apiKey(undefined)).resolves.toBe("secret");
		await expect(host.stranger.account().methods.apiKey(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(host.account.methods.apiKey(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(host.stranger.account().methods.siteDomain(undefined)).resolves.toBe(
			"anaconda.test",
		);
	});

	it("never gives the API key to a window, even one claiming to be kilo.local-inference", async () => {
		const host = await boot({ apiKey: "secret" });

		await expect(
			host.windowLocalInference.account().methods.apiKey(undefined),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(host.windowLocalInference.account().methods.siteDomain(undefined)).resolves.toBe(
			"anaconda.test",
		);
	});

	it("signs in through the browser, stores the key, focuses the app and reports it once", async () => {
		const host = await boot();
		const changed = vi.fn();
		host.account.on("changed", changed);

		const first = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.account.getState().signingIn).toBe(true), WAIT);
		await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
		const second = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.authorize.authorizer.reopen).toHaveBeenCalled(), WAIT);
		host.authorize.complete();

		await expect(first).resolves.toEqual({ ok: true });
		await expect(second).resolves.toEqual({ ok: true });
		expect(host.login).toHaveBeenCalledTimes(1);
		expect(host.credentials.saveApiKey).toHaveBeenCalledWith("new-key");
		expect(host.account.getState()).toEqual({ session: SIGNED_IN, signingIn: false });
		expect(changed).toHaveBeenCalled();
		await vi.waitFor(() => expect(host.focusMain).toHaveBeenCalledTimes(1), WAIT);
		await vi.waitFor(() => expect(host.tracked).toHaveBeenCalledWith("Anaconda Logged In"), WAIT);
		expect(host.tracked).toHaveBeenCalledTimes(1);
	});

	it("reports a cancelled sign-in as cancelled, without focusing or tracking", async () => {
		const host = await boot();

		const pending = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
		await host.account.methods.cancelSignIn(undefined);

		await expect(pending).resolves.toEqual({
			ok: false,
			reason: "Sign-in was cancelled.",
			cancelled: true,
		});
		expect(host.account.getState().signingIn).toBe(false);
		expect(host.focusMain).not.toHaveBeenCalled();
		expect(host.tracked).not.toHaveBeenCalled();
	});

	it("does not treat a later sign-in as cancelled", async () => {
		const host = await boot();
		await host.account.methods.cancelSignIn(undefined);

		const pending = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
		host.authorize.complete();

		await expect(pending).resolves.toEqual({ ok: true });
	});

	it("reports sign-in failures with their reason", async () => {
		const failing = await boot({
			login: async () => Promise.reject(new Error("Port 8000 is in use.")),
		});
		await expect(failing.account.methods.signIn(undefined)).resolves.toEqual({
			ok: false,
			reason: "Port 8000 is in use.",
		});

		const rejected = await boot({
			login: async () => ({ access_token: "t", token_type: "bearer", raw: {} as never }),
			fetch: async () => new Response("", { status: 401 }),
		});
		await expect(rejected.account.methods.signIn(undefined)).resolves.toEqual({
			ok: false,
			reason: "Anaconda sign-in did not complete.",
		});
		expect(failing.tracked).not.toHaveBeenCalled();
	});

	it("signs out, deletes the key and reports it", async () => {
		const host = await boot({ apiKey: "stored-key" });
		await host.account.methods.session(undefined);

		await expect(host.account.methods.signOut(undefined)).resolves.toEqual({ ok: true });

		expect(host.credentials.deleteApiKey).toHaveBeenCalledTimes(1);
		expect(host.account.getState().session).toEqual({ status: "anonymous" });
		await vi.waitFor(() => expect(host.tracked).toHaveBeenCalledWith("Anaconda Logged Out"), WAIT);
	});

	it("reports a sign-out the keyring refuses", async () => {
		const host = await boot({ apiKey: "stored-key" });
		host.credentials.deleteApiKey.mockRejectedValueOnce(
			new Error("The Anaconda keyring is read-only."),
		);

		await expect(host.account.methods.signOut(undefined)).resolves.toEqual({
			ok: false,
			reason: "The Anaconda keyring is read-only.",
		});
		expect(host.tracked).not.toHaveBeenCalled();
	});
});
