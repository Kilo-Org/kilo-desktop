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
import type { KiloProvider, KiloProviderList } from "./kilo-models-client";
import { activateModels, type ModelsOptions } from "./models";
import { createFakeKiloClient, type FakeKiloClient } from "./test-kilo-client";

const acme = (modelId: string) => ({ aiProviderId: "acme", modelId });
const saved = (modelID: string) => ({ providerID: "acme", modelID });

const anthropic: KiloProvider = {
	id: "anthropic",
	name: "Anthropic",
	source: "api",
	models: { sonnet: { id: "sonnet", name: "Sonnet" } },
};
const kilo: KiloProvider = {
	id: "kilo",
	name: "Kilo Gateway",
	source: "custom",
	models: { "kilo-auto/free": { id: "kilo-auto/free", name: "Auto Free", isFree: true } },
};
const local: KiloProvider = {
	id: "local-server",
	name: "Local Model Server",
	source: "config",
	models: { qwen: { id: "qwen", name: "Qwen" } },
};
const LIST: KiloProviderList = { all: [kilo, anthropic], connected: ["kilo", "anthropic"] };

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

function signedIn(currentOrgId: string | null): AccountState {
	return {
		...SIGNED_OUT,
		signedIn: true,
		profile: {
			profile: { email: "ada@example.com" },
			balance: null,
			kiloPass: null,
			currentOrgId,
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
	const fake = options.fake ?? createFakeKiloClient({ list: LIST });
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

	it("adopts origin's preferences once", async () => {
		const storage = createMemoryStorage("/data/plugins/kilo.core");
		const origin = vi.fn(async () => ({
			modelSelections: { plan: saved("deep"), broken: { providerID: "" } },
			preferred: { ...saved("deep"), variant: "low" },
			variantSelections: { "plan/acme/deep": "low", bad: 3 },
			recentModels: [saved("deep"), saved("deep"), "nope"],
			autoFreeModelsEnabled: false,
		}));
		const { models } = await bootModels({ storage, savedPreferences: { origin } });

		expect(models.getState().preferences).toEqual({
			byAgent: { plan: acme("deep") },
			preferred: { ...acme("deep"), variant: "low" },
			variants: { "plan/acme/deep": "low" },
			recent: [acme("deep")],
			favorites: [],
			autoFreeModels: false,
		});
		await models.methods.recordRecent(acme("fast"));
		await bootModels({ storage, savedPreferences: { origin } });
		expect(origin).toHaveBeenCalledTimes(1);
	});

	it("adopts kilo.chat's preferences and favourites, without origin's when kilo.chat already had them", async () => {
		const origin = vi.fn(async () => ({ recentModels: [saved("origin")] }));
		const { models } = await bootModels({
			savedPreferences: {
				kiloChat: async () => ({
					modelSelections: { code: saved("fast") },
					variantSelections: { "code/acme/fast": "high" },
					recentModels: [saved("fast")],
					favorites: [saved("fast"), saved("fast"), saved("deep")],
					autoFreeModelsEnabled: false,
					importedFromOrigin: true,
					importedOriginFavorites: true,
				}),
				origin,
			},
		});

		expect(models.getState().preferences).toEqual({
			byAgent: { code: acme("fast") },
			variants: { "code/acme/fast": "high" },
			recent: [acme("fast")],
			favorites: [acme("fast"), acme("deep")],
			autoFreeModels: false,
		});
		expect(origin).not.toHaveBeenCalled();
	});

	it("adopts origin's beneath kilo.chat's when kilo.chat never read origin's", async () => {
		const { models } = await bootModels({
			savedPreferences: {
				kiloChat: async () => ({
					modelSelections: { code: saved("fast") },
					recentModels: [saved("fast")],
					autoFreeModelsEnabled: true,
				}),
				origin: async () => ({
					modelSelections: { code: saved("old"), plan: saved("deep") },
					recentModels: [saved("deep")],
					autoFreeModelsEnabled: false,
				}),
			},
		});

		expect(models.getState().preferences).toMatchObject({
			byAgent: { code: acme("fast"), plan: acme("deep") },
			recent: [acme("fast"), acme("deep")],
			autoFreeModels: false,
		});
	});

	it("starts empty when the predecessors have none or their files can't be read", async () => {
		const none = await bootModels({
			savedPreferences: { kiloChat: async () => null, origin: async () => null },
		});
		const broken = await bootModels({
			savedPreferences: {
				origin: async () => {
					throw new Error("corrupt");
				},
			},
		});
		for (const { models } of [none, broken]) {
			expect(models.getState().preferences).toEqual({
				byAgent: {},
				variants: {},
				recent: [],
				favorites: [],
				autoFreeModels: true,
			});
		}
	});

	it("tries the predecessors again next launch when they can't be read", async () => {
		const storage = createMemoryStorage("/data/plugins/kilo.core");
		await bootModels({
			storage,
			savedPreferences: {
				kiloChat: async () => {
					throw new Error("EBUSY");
				},
			},
		});

		const { models } = await bootModels({
			storage,
			savedPreferences: { kiloChat: async () => ({ recentModels: [saved("deep")] }) },
		});

		expect(models.getState().preferences.recent).toEqual([acme("deep")]);
	});

	it("keeps choices made here when origin's preferences are read a launch later", async () => {
		const storage = createMemoryStorage("/data/plugins/kilo.core");
		const first = await bootModels({
			storage,
			savedPreferences: {
				origin: async () => {
					throw new Error("EBUSY");
				},
			},
		});
		await first.models.methods.remember({ agent: "code", model: acme("fast") });
		await first.models.methods.setAutoFreeModels({ enabled: false });

		const { models } = await bootModels({
			storage,
			savedPreferences: {
				origin: async () => ({
					modelSelections: { code: saved("deep"), plan: saved("deep") },
					preferred: { ...saved("deep"), variant: "low" },
					variantSelections: { "code/acme/fast": "low", "plan/acme/deep": "low" },
					recentModels: [saved("deep"), saved("fast")],
					autoFreeModelsEnabled: true,
				}),
			},
		});

		expect(models.getState().preferences).toEqual({
			byAgent: { code: acme("fast"), plan: acme("deep") },
			preferred: { ...acme("fast"), variant: "" },
			variants: { "code/acme/fast": "", "plan/acme/deep": "low" },
			recent: [acme("fast"), acme("deep")],
			favorites: [],
			autoFreeModels: false,
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

	it("reads again on refresh, starting the server if needed", async () => {
		const { models, fake } = await bootModels({ serverStatus: "stopped" });
		fake.list = { all: [anthropic], connected: ["anthropic"] };

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
		fake.list = { all: [anthropic], connected: ["anthropic"] };
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
		const fake = createFakeKiloClient({ list: { all: [], connected: [] } });
		const { models, readsSettled } = await bootModels({ fake });
		await readsSettled(1);
		expect(models.getState().ready).toBe(false);

		fake.list = LIST;
		await readsSettled(2);
		await vi.waitFor(() => expect(models.getState().ready).toBe(true));
	});

	it("is ready with no AI providers when the list stays empty", async () => {
		const fake = createFakeKiloClient({ list: { all: [], connected: [] } });
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
		fake.list = { all: [anthropic], connected: ["anthropic"] };
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
		await new Promise((resolve) => setTimeout(resolve, 20));
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
		await new Promise((resolve) => setTimeout(resolve, 20));
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
			list: { all: [kilo, local], connected: ["kilo", "local-server"] },
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
	it("connects and disconnects an AI provider, disposing the server and reading again", async () => {
		const { asShell, fake, readsSettled, models } = await bootModels();
		await readsSettled(1);

		fake.list = {
			all: [kilo, anthropic, { ...anthropic, id: "openai", name: "OpenAI" }],
			connected: ["kilo", "anthropic", "openai"],
		};
		await asShell.methods.connectAiProvider({ aiProviderId: "openai", apiKey: " sk-o " });
		expect(fake.calls.set).toEqual([{ aiProviderId: "openai", key: "sk-o" }]);
		expect(fake.calls.dispose).toBe(1);
		expect(models.getState().aiProviders.openai).toMatchObject({ connected: true });

		await asShell.methods.disconnectAiProvider({ aiProviderId: "openai" });
		expect(fake.calls.remove).toEqual(["openai"]);
		expect(fake.calls.dispose).toBe(2);
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
		expect(fake.config.provider?.vllm).toEqual({
			npm: "@ai-sdk/openai-compatible",
			name: "vLLM",
			options: { baseURL: "http://127.0.0.1:8000/v1" },
			models: {
				llama: {
					name: "Llama",
					modalities: { input: ["text", "image"], output: ["text"] },
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
