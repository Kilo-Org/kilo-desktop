import { describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	type DomainObjectProvider,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
	testPlugin,
} from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import {
	AiProviderPoint,
	CORE_DEFINITIONS,
	KiloAccount,
	KiloServer,
	Models,
	type AccountState,
	type ServerConnection,
} from "../../contracts";
import { GATEWAY_CATALOG_FRESH_MS } from "./gateway-catalog";
import type { KiloCatalog } from "./kilo-models-client";
import { activateModels, type ModelsOptions } from "./models";
import {
	createFakeKiloClient,
	EMPTY_CATALOG,
	model,
	provider,
	type FakeKiloClient,
} from "./test-kilo-client";

const acme = (modelId: string) => ({ aiProviderId: "acme", modelId });

/** Kilo's catalog with these AI providers enabled, each offering one model. */
function catalogOf(...ids: ("kilo" | "anthropic" | "local-server" | "openai")[]): KiloCatalog {
	const offered = {
		kilo: { name: "Kilo Gateway", model: model("kilo", "kilo-auto/free", { name: "Auto Free" }) },
		anthropic: { name: "Anthropic", model: model("anthropic", "sonnet", { name: "Sonnet" }) },
		"local-server": {
			name: "Local Model Server",
			model: model("local-server", "qwen", { name: "Qwen" }),
		},
		openai: { name: "OpenAI", model: model("openai", "gpt", { name: "GPT" }) },
	};
	return {
		...EMPTY_CATALOG,
		providers: ids.map((id) => provider(id, { name: offered[id].name })),
		models: ids.map((id) => offered[id].model),
		gateway: ids.includes("kilo") ? [{ id: "kilo-auto/free", isFree: true }] : [],
	};
}
const CATALOG = catalogOf("kilo", "anthropic");

const SIGNED_OUT: AccountState = {
	connection: "connected",
	signedIn: false,
	profile: null,
	profileError: null,
	deviceSignIn: { status: "idle" },
	organizationError: null,
	refreshing: false,
	switchingOrganization: false,
};

function signedIn(organizationId: string | null): AccountState {
	return {
		...SIGNED_OUT,
		signedIn: true,
		profile: {
			email: "ada@example.com",
			organizations: [],
			hasPersonalAccount: true,
			organizationId,
			balance: null,
			kiloPass: null,
		},
	};
}

interface BootOptions extends Partial<ModelsOptions> {
	readonly storage?: ReturnType<typeof createMemoryStorage>;
	readonly fake?: FakeKiloClient;
	readonly serverStatus?: "stopped" | "ready";
	/** Leaves kilo.core/server unprovided. */
	readonly withoutServer?: boolean;
	readonly account?: AccountState;
	/** Contributes `local-server` to `kilo.core/ai-provider` from acme.local. */
	readonly localServer?: boolean;
	/** Also boots a window's kernel linked to main. */
	readonly withWindow?: boolean;
}

/** kilo.core's models area in a main kernel, with fakes of kilo.core's server and account. */
async function bootModels(options: BootOptions = {}) {
	const fake = options.fake ?? createFakeKiloClient({ catalog: CATALOG });
	const storage = options.storage ?? createMemoryStorage("/data/plugins/kilo.core");
	const connections: ServerConnection[] = [];
	let server: DomainObjectProvider<typeof KiloServer> | undefined;
	let account: DomainObjectProvider<typeof KiloAccount> | undefined;
	const createClient = vi.fn((connection: ServerConnection) => {
		connections.push(connection);
		return fake.client;
	});
	const core: PluginRegistration = {
		manifest,
		definitions: CORE_DEFINITIONS,
		entry: definePlugin({
			async activate(sdk) {
				if (!options.withoutServer) {
					server = sdk.domainObjects.provide(KiloServer, {
						initialState: { status: options.serverStatus ?? "ready" },
						methods: {
							connect: () => {
								server!.setState({ status: "ready" });
								return {
									baseUrl: "http://127.0.0.1:4096",
									username: "kilo",
									password: `pw-${connections.length}`,
									version: "7.8.27",
									globalDirectory: "/home",
								};
							},
							restart: () => undefined,
							disposeInstance: () => undefined,
							userConfigFile: () => ({ path: "/home/.config/kilo/kilo.json", exists: false }),
						},
					});
				}
				if (options.account) {
					account = sdk.domainObjects.provide(KiloAccount, {
						initialState: options.account,
						methods: {
							signIn: () => ({ signedIn: true }),
							cancelSignIn: () => undefined,
							signOut: () => undefined,
							refresh: () => undefined,
							setOrganization: () => undefined,
						},
					});
				}
				await activateModels(sdk, {
					createClient,
					fetch: options.fetch ?? vi.fn<typeof fetch>(),
					emptyListRetryMs: 0,
					...options,
				});
			},
		}),
	};
	const localServer = testPlugin("acme.local", {
		manifest: {
			contributes: {
				extensions: { "kilo.core/ai-provider": [{ id: "local", aiProviderId: "local-server" }] },
			},
		},
		entry: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(AiProviderPoint, "local", { read: () => undefined });
			},
		}),
	});
	const registrations = [
		core,
		testPlugin("kilo.shell"),
		testPlugin("acme.other"),
		...(options.localServer ? [localServer] : []),
	];
	const hostServices = () => ({ storage, net: { fetch: vi.fn<typeof fetch>() } });
	const pair = options.withWindow
		? await createTestKernelPair({
				main: registrations,
				renderer: [{ manifest, definitions: CORE_DEFINITIONS }],
				mainHostServices: hostServices,
			})
		: undefined;
	const kernel =
		pair?.main ?? createMainKernel({ host: createTestHost(), registrations, hostServices });
	if (!pair) await kernel.start();
	const models = kernel.kernelSdk.domainObjects.get(Models)!;
	const asPlugin = (pluginId: string) => kernel.sdkFor(pluginId).domainObjects.get(Models)!;
	return {
		kernel,
		/** A window's kernel, with `withWindow`. */
		window: pair?.renderer,
		fake,
		storage,
		models,
		asShell: asPlugin("kilo.shell"),
		asOther: asPlugin("acme.other"),
		connections,
		setServerStatus: (status: "stopped" | "starting" | "ready") => server!.setState({ status }),
		setAccount: (state: AccountState) => account!.setState(state),
		/** Resolves once the models were read `count` times in total. */
		readsSettled: (count: number) =>
			vi.waitFor(() => {
				expect(fake.calls.list).toBe(count);
			}),
	};
}

describe("model preferences", () => {
	it("remembers new-chat choices, recent models and favourites across restarts", async () => {
		const storage = createMemoryStorage("/data/plugins/kilo.core");
		const { models } = await bootModels({ storage });

		await models.methods.remember({ agent: "code", model: acme("fast"), variant: "high" });
		await models.methods.recordRecent(acme("deep"));
		await models.methods.recordRecent(acme("fast"));
		await models.methods.setFavorite({ ...acme("deep"), favorite: true });
		await models.methods.setFavorite({ ...acme("fast"), favorite: true });
		await models.methods.setFavorite({ ...acme("deep"), favorite: false });
		await models.methods.setAutoFreeModels({ enabled: false });

		const restarted = await bootModels({ storage });
		expect(restarted.models.getState().preferences).toEqual({
			byAgent: { code: acme("fast") },
			preferred: { ...acme("fast"), variant: "high" },
			variants: { "code/acme/fast": "high" },
			recent: [acme("fast"), acme("deep")],
			favorites: [acme("fast")],
			autoFreeModels: false,
		});
	});

	it("keeps the five most recent models", async () => {
		const { models } = await bootModels();
		for (const id of ["a", "b", "c", "d", "e", "f"]) {
			await models.methods.recordRecent(acme(id));
		}
		expect(models.getState().preferences.recent.map((model) => model.modelId)).toEqual([
			"f",
			"e",
			"d",
			"c",
			"b",
		]);
	});

	it("starts empty on the first Kilo v2 launch, keeping only the free-models switch", async () => {
		const storage = createMemoryStorage("/data/plugins/kilo.core");
		storage.kv<Record<string, unknown>>({ namespace: "models-preferences", defaults: {} }).set({
			byAgent: { code: acme("fast") },
			preferred: { ...acme("fast"), variant: "high" },
			variants: { "code/acme/fast": "high" },
			recent: [acme("fast")],
			favorites: [acme("deep")],
			autoFreeModels: false,
			autoFreeChosenHere: true,
		});

		const { models } = await bootModels({ storage });

		expect(models.getState().preferences).toEqual({
			byAgent: {},
			variants: {},
			recent: [],
			favorites: [],
			autoFreeModels: false,
		});
	});

	it("keeps choices made on Kilo v2 across launches", async () => {
		const storage = createMemoryStorage("/data/plugins/kilo.core");
		const first = await bootModels({ storage });
		await first.models.methods.remember({ agent: "code", model: acme("fast") });

		const { models } = await bootModels({ storage });

		expect(models.getState().preferences).toMatchObject({
			byAgent: { code: acme("fast") },
			recent: [acme("fast")],
		});
	});
});

describe("gateway catalog", () => {
	function gatewayFetch() {
		return vi.fn<typeof globalThis.fetch>(async (input) => {
			const url = String(input instanceof Request ? input.url : input);
			return url.includes("stats")
				? Response.json([])
				: Response.json({ data: [{ id: "openai/gpt-5", context_length: 128_000 }] });
		});
	}

	it("reads the catalog once for every window while it is fresh", async () => {
		let now = 1_000;
		const fetch = gatewayFetch();
		const { models } = await bootModels({ fetch, now: () => now });

		await Promise.all([
			models.methods.refreshGatewayCatalog(undefined),
			models.methods.refreshGatewayCatalog(undefined),
		]);
		const calls = fetch.mock.calls.length;
		expect(models.getState().gatewayCatalog).toEqual({
			details: [{ modelId: "openai/gpt-5", contextWindow: 128_000 }],
			fetchedAt: 1_000,
		});

		await models.methods.refreshGatewayCatalog(undefined);
		expect(fetch.mock.calls.length).toBe(calls);

		now += GATEWAY_CATALOG_FRESH_MS;
		await models.methods.refreshGatewayCatalog(undefined);
		expect(fetch.mock.calls.length).toBeGreaterThan(calls);
	});

	it("keeps the last catalog when a read fails", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("down", { status: 503 }));
		const { models } = await bootModels({ fetch });

		await expect(models.methods.refreshGatewayCatalog(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		expect(models.getState().gatewayCatalog).toEqual({ details: [], fetchedAt: null });
	});
});

describe("AI providers and models", () => {
	it("reads the AI providers and their models once the server is ready", async () => {
		const { models, readsSettled, connections } = await bootModels();
		await readsSettled(1);

		await vi.waitFor(() => expect(models.getState().ready).toBe(true));
		const state = models.getState();
		expect(Object.keys(state.models)).toEqual(["kilo/kilo-auto/free", "anthropic/sonnet"]);
		expect(state.aiProviders.kilo).toMatchObject({ source: "kilo", connected: true });
		expect(models.lookup("anthropic/sonnet")).toMatchObject({ name: "Sonnet", free: false });
		expect(connections[0]).toMatchObject({ baseUrl: "http://127.0.0.1:4096", username: "kilo" });
	});

	it("waits for the server instead of starting it, and reads when it becomes ready", async () => {
		const { models, fake, setServerStatus, readsSettled } = await bootModels({
			serverStatus: "stopped",
		});
		expect(fake.calls.list).toBe(0);
		expect(models.getState().ready).toBe(false);

		setServerStatus("starting");
		setServerStatus("ready");
		await readsSettled(1);
		await vi.waitFor(() => expect(models.getState().ready).toBe(true));

		setServerStatus("ready");
		setServerStatus("stopped");
		setServerStatus("ready");
		await readsSettled(2);
	});

	it("reads again when Kilo announces a change to its catalog", async () => {
		const { models, fake, readsSettled } = await bootModels();
		await readsSettled(1);
		await vi.waitFor(() => expect(models.getState().ready).toBe(true));

		fake.catalog = catalogOf("anthropic");
		fake.announce();

		await readsSettled(2);
		await vi.waitFor(() =>
			expect(Object.keys(models.getState().models)).toEqual(["anthropic/sonnet"]),
		);
	});

	it("reads again on refresh, starting the server if needed", async () => {
		const { models, fake } = await bootModels({ serverStatus: "stopped" });
		fake.catalog = catalogOf("anthropic");

		await models.methods.refresh(undefined);

		expect(fake.calls.list).toBe(1);
		expect(Object.keys(models.getState().models)).toEqual(["anthropic/sonnet"]);
	});

	it("runs one more read for refreshes that come during a read", async () => {
		const { models, fake, readsSettled } = await bootModels();
		await readsSettled(1);
		let open!: () => void;
		fake.listGate = new Promise((resolve) => (open = resolve));

		const first = models.methods.refresh(undefined);
		const second = models.methods.refresh(undefined);
		const third = models.methods.refresh(undefined);
		fake.catalog = catalogOf("anthropic");
		open();
		await Promise.all([first, second, third]);

		expect(fake.calls.list).toBe(3);
		expect(Object.keys(models.getState().models)).toEqual(["anthropic/sonnet"]);
	});

	it("keeps the last AI providers when a read fails", async () => {
		const { models, fake, readsSettled } = await bootModels();
		await readsSettled(1);
		await vi.waitFor(() => expect(models.getState().ready).toBe(true));
		fake.listError = new Error("connection refused");

		await expect(models.methods.refresh(undefined)).rejects.toThrow();
		expect(Object.keys(models.getState().models)).toHaveLength(2);
	});

	it("reads an empty list again before believing it", async () => {
		const fake = createFakeKiloClient();
		const { models, readsSettled } = await bootModels({ fake });
		await readsSettled(1);
		expect(models.getState().ready).toBe(false);

		fake.catalog = CATALOG;
		await readsSettled(2);
		await vi.waitFor(() => expect(models.getState().ready).toBe(true));
	});

	it("is ready with no AI providers when the list stays empty", async () => {
		const fake = createFakeKiloClient();
		const { models } = await bootModels({ fake });

		await vi.waitFor(() => expect(models.getState().ready).toBe(true));
		expect(fake.calls.list).toBe(6);
	});

	it("can't refresh without the server", async () => {
		const { models, fake } = await bootModels({ withoutServer: true });
		await expect(models.methods.refresh(undefined)).rejects.toMatchObject({ code: "UNAVAILABLE" });
		expect(fake.calls.list).toBe(0);
	});

	it("reads again when the account signs in, out or changes organisation", async () => {
		const { setAccount, readsSettled, fake } = await bootModels({ account: SIGNED_OUT });
		await readsSettled(1);

		setAccount({ ...signedIn(null), profile: null });
		await readsSettled(2);
		setAccount(signedIn("org-1"));
		await readsSettled(3);
		setAccount({ ...signedIn("org-1"), refreshing: true });
		setAccount({ ...signedIn("org-1"), profile: null });
		setAccount(signedIn("org-1"));
		setAccount(SIGNED_OUT);
		await readsSettled(4);
		expect(fake.calls.list).toBe(4);
	});

	it("says its lists are the previous account's until they are read for a new account", async () => {
		const { models, fake, setAccount, readsSettled } = await bootModels({ account: SIGNED_OUT });
		await readsSettled(1);
		await vi.waitFor(() => expect(models.getState().ready).toBe(true));
		expect(models.getState().followingAccount).toBe(false);
		let open!: () => void;
		fake.listGate = new Promise((resolve) => (open = resolve));

		setAccount(signedIn("org-1"));

		// Before the account's change reaches anyone else, so no window sees it without this.
		expect(models.getState().followingAccount).toBe(true);
		fake.catalog = catalogOf("anthropic");
		open();
		await vi.waitFor(() => expect(models.getState().followingAccount).toBe(false));
		expect(Object.keys(models.getState().models)).toEqual(["anthropic/sonnet"]);
	});

	it("reaches a window as following the account before the account's change does", async () => {
		const { window, fake, setAccount, readsSettled } = await bootModels({
			account: SIGNED_OUT,
			withWindow: true,
		});
		await readsSettled(1);
		fake.listGate = new Promise(() => {});
		const account = window!.kernelSdk.domainObjects.get(KiloAccount)!;
		const windowModels = window!.kernelSdk.domainObjects.get(Models)!;
		await vi.waitFor(() => expect(windowModels.getState().ready).toBe(true));
		const seenWhenSignedIn: boolean[] = [];
		account.subscribe((state) => {
			if (state.signedIn) seenWhenSignedIn.push(windowModels.getState().followingAccount);
		});

		setAccount(signedIn("org-1"));

		await vi.waitFor(() => expect(seenWhenSignedIn).toEqual([true]));
	});

	it("keeps following the account while the server it waits for isn't ready", async () => {
		const { models, setAccount, setServerStatus, readsSettled } = await bootModels({
			account: SIGNED_OUT,
		});
		await readsSettled(1);
		setServerStatus("stopped");

		setAccount(signedIn("org-1"));
		expect(models.getState().followingAccount).toBe(true);

		setServerStatus("ready");
		await readsSettled(2);
		await vi.waitFor(() => expect(models.getState().followingAccount).toBe(false));
	});

	it("keeps following the account while reading for it fails, until a read lands", async () => {
		const { models, fake, setAccount, readsSettled } = await bootModels({ account: SIGNED_OUT });
		await readsSettled(1);
		fake.listError = new Error("connection refused");

		setAccount(signedIn("org-1"));
		await readsSettled(2);
		expect(models.getState().followingAccount).toBe(true);

		delete fake.listError;
		await models.methods.refresh(undefined);
		expect(models.getState().followingAccount).toBe(false);
	});

	it("keeps following the account when it changes again during a read", async () => {
		const { models, fake, setAccount, readsSettled } = await bootModels({ account: SIGNED_OUT });
		await readsSettled(1);
		let open!: () => void;
		fake.listGate = new Promise((resolve) => (open = resolve));
		setAccount(signedIn("org-1"));
		await readsSettled(2);
		let openSecond!: () => void;
		const second = new Promise<void>((resolve) => (openSecond = resolve));

		setAccount(signedIn("org-2"));
		fake.listGate = second;
		open();
		await readsSettled(3);
		expect(models.getState().followingAccount).toBe(true);

		openSecond();
		await vi.waitFor(() => expect(models.getState().followingAccount).toBe(false));
	});

	it("marks plugin-contributed AI providers and follows contribution changes", async () => {
		const fake = createFakeKiloClient({
			catalog: catalogOf("kilo", "local-server"),
		});
		const { kernel, models, readsSettled } = await bootModels({ fake, localServer: true });
		// The first read precedes acme.local's activation; its implementation is a change.
		await readsSettled(2);
		await vi.waitFor(() =>
			expect(models.getState().aiProviders["local-server"]).toMatchObject({
				source: "plugin",
				canDisconnect: false,
			}),
		);
		expect(models.lookup("local-server/qwen")).toMatchObject({ name: "Qwen" });

		const added = kernel.sdkFor("acme.local").extensions.add(
			AiProviderPoint,
			{ id: "other", aiProviderId: "other-local" },
			{
				read: () => undefined,
			},
		);
		await readsSettled(3);
		added.remove();
		await readsSettled(4);
	});
});

describe("AI provider mutations", () => {
	it("connects and disconnects an AI provider, reloading the server and reading again", async () => {
		const { asShell, fake, readsSettled, models } = await bootModels();
		await readsSettled(1);

		fake.catalog = catalogOf("kilo", "anthropic", "openai");
		await asShell.methods.connectAiProvider({ aiProviderId: "openai", apiKey: " sk-o " });
		expect(fake.calls.set).toEqual([{ aiProviderId: "openai", key: "sk-o" }]);
		expect(fake.calls.reload).toBe(1);
		expect(models.getState().aiProviders.openai).toMatchObject({ connected: true });

		await asShell.methods.disconnectAiProvider({ aiProviderId: "openai" });
		expect(fake.calls.remove).toEqual(["openai"]);
		expect(fake.calls.reload).toBe(2);
		expect(fake.calls.list).toBe(3);
	});

	it("saves a custom AI provider and reads it back for editing", async () => {
		const { asShell, models, fake, readsSettled } = await bootModels();
		await readsSettled(1);

		await models.methods.saveCustomAiProvider({
			aiProviderId: "vllm",
			name: "vLLM",
			baseUrl: "http://127.0.0.1:8000/v1",
			apiKey: "sk-v",
			models: [{ modelId: "llama", name: "Llama", attachments: true, contextWindow: 32_000 }],
		});
		expect(fake.config.providers?.vllm).toEqual({
			package: "@ai-sdk/openai-compatible",
			name: "vLLM",
			settings: { baseURL: "http://127.0.0.1:8000/v1" },
			models: {
				llama: {
					name: "Llama",
					capabilities: { input: ["text", "image"], output: ["text"] },
					limit: { context: 32_000, output: 0 },
				},
			},
		});
		expect(models.getState().aiProviders.vllm).toMatchObject({ source: "custom" });

		await expect(asShell.methods.customAiProvider({ aiProviderId: "vllm" })).resolves.toEqual({
			aiProviderId: "vllm",
			name: "vLLM",
			baseUrl: "http://127.0.0.1:8000/v1",
			apiFormat: "openai-compatible",
			models: [{ modelId: "llama", name: "Llama", attachments: true, contextWindow: 32_000 }],
		});
	});

	it("refuses a custom AI provider that would replace another AI provider", async () => {
		const { asShell, readsSettled, models } = await bootModels();
		await readsSettled(1);
		await vi.waitFor(() => expect(models.getState().ready).toBe(true));

		await expect(
			asShell.methods.saveCustomAiProvider({
				aiProviderId: "anthropic",
				name: "Mine",
				baseUrl: "https://example.com/v1",
				models: [{ modelId: "m", name: "M" }],
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("refuses to change Kilo's gateway or a plugin's AI provider", async () => {
		const { asShell, fake } = await bootModels({ localServer: true });

		await expect(
			asShell.methods.connectAiProvider({ aiProviderId: "kilo", apiKey: "k" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
		await expect(
			asShell.methods.disconnectAiProvider({ aiProviderId: "local-server" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
		expect(fake.calls.order).toEqual([]);
	});

	it("still succeeds when reading the AI providers after a change fails", async () => {
		const { asShell, fake, readsSettled } = await bootModels();
		await readsSettled(1);
		fake.listError = new Error("offline");

		await expect(
			asShell.methods.connectAiProvider({ aiProviderId: "openai", apiKey: "sk" }),
		).resolves.toBeUndefined();
		expect(fake.calls.set).toHaveLength(1);
	});

	it("refuses credential methods to other plugins", async () => {
		const { asOther, fake } = await bootModels();
		const custom = {
			aiProviderId: "vllm",
			name: "vLLM",
			baseUrl: "http://127.0.0.1:8000/v1",
			models: [{ modelId: "llama", name: "Llama" }],
		};

		for (const call of [
			() => asOther.methods.connectAiProvider({ aiProviderId: "openai", apiKey: "sk" }),
			() => asOther.methods.disconnectAiProvider({ aiProviderId: "openai" }),
			() => asOther.methods.saveCustomAiProvider(custom),
			() => asOther.methods.customAiProvider({ aiProviderId: "vllm" }),
			() => asOther.methods.presentEnv({ names: ["HOME"] }),
		]) {
			await expect(call()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		}
		expect(fake.calls.order).toEqual([]);
	});

	it("says which environment variables are set", async () => {
		const { asShell } = await bootModels({ env: { AWS_PROFILE: "default", AWS_REGION: " " } });
		await expect(
			asShell.methods.presentEnv({ names: ["AWS_REGION", "AWS_PROFILE", "GROQ_API_KEY"] }),
		).resolves.toEqual({ names: ["AWS_PROFILE"] });
	});
});
