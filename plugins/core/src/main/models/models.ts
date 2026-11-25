import {
	KERNEL_OWNER,
	KernelError,
	mainHost,
	type DomainObjectCaller,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import {
	AiProviderPoint,
	CORE_PLUGIN_ID,
	KILO_AI_PROVIDER_ID,
	KiloAccount,
	KiloServer,
	Models,
	type AccountState,
	type ModelsState,
} from "../../contracts";
import { mapAiProviderList } from "./ai-provider-list";
import {
	connectAiProvider,
	disconnectAiProvider,
	readCustomAiProvider,
	saveCustomAiProvider,
} from "./ai-provider-mutations";
import { fetchGatewayModelDetails, GATEWAY_CATALOG_FRESH_MS } from "./gateway-catalog";
import type { CreateKiloModelsClient, KiloModelsClient } from "./kilo-models-client";
import { openModelPreferences } from "./preferences";
import { presentEnvNames } from "./present-env";

/**
 * The `kilo.core/models` domain object: every model the app can use, with
 * its AI provider, and the user's choices among them.
 *
 * AI providers and models are read from the running Kilo server
 * (`provider.list` and the user's global config), through kilo.core's own
 * `kilo.core/server` connection. Reads happen when the server becomes ready,
 * on `refresh()`, after this area's own mutations, when the signed-in
 * account or its organisation changes (`kilo.core/account`, optional) and
 * when `kilo.core/ai-provider` contributions change. Reads never overlap:
 * a trigger during a read runs one more read after it, so the last state
 * always reflects the latest trigger. Automatic reads only use a server
 * that is already ready; `refresh()` and mutations start it. A list with no
 * AI providers at all means Kilo is still loading them, so it is read again
 * a few times before it is believed. A failed read keeps the last state.
 *
 * An account change sets `followingAccount` inside the account's own update
 * (state listeners run before the change is sent to windows, so every window
 * sees it first), and only a read that started after the latest change and
 * landed clears it; a failed read leaves the previous account's lists, so it
 * stays set. Chat waits on it so a turn isn't sent with a model only the
 * previous account was offered.
 *
 * Mutations hand credentials to Kilo, so they (and `customAiProvider`,
 * `presentEnv`) are refused to every caller but kilo.core, kilo.shell and
 * the main kernel. Kilo's gateway and plugin-contributed AI providers are
 * managed elsewhere (the account, the contributing plugin) and refused too.
 *
 * Preferences live in kilo.core's kv (see `preferences.ts`); the gateway
 * catalog is public presentation data, read on demand and shared by every
 * window, with concurrent refreshes sharing one read.
 */

export interface ModelsOptions {
	/** A client for the running Kilo server's model API. */
	readonly createClient: CreateKiloModelsClient;
	/** Reads Kilo's public gateway catalog. */
	readonly fetch: typeof globalThis.fetch;
	/** The environment `presentEnv` checks. */
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	/** Wait before reading an empty AI provider list again. */
	readonly emptyListRetryMs?: number;
}

/** The plugins besides kilo.core that may change AI provider credentials. */
const CREDENTIAL_CALLERS: ReadonlySet<string> = new Set([CORE_PLUGIN_ID, "kilo.shell"]);

const EMPTY_LIST_RETRIES = 5;

function assertCredentialCaller(caller: DomainObjectCaller): void {
	if (CREDENTIAL_CALLERS.has(caller.pluginId)) return;
	if (caller.pluginId === KERNEL_OWNER && caller.process === "main") return;
	throw new KernelError(
		"PERMISSION_DENIED",
		"Only kilo.core and kilo.shell manage AI provider credentials.",
	);
}

interface AccountKey {
	readonly signedIn: boolean | null;
	readonly organizationId: string | null;
}

/** Who is signed in and in which organisation; an unread profile keeps the last organisation. */
function accountKey(state: AccountState, previous: AccountKey | undefined): AccountKey {
	return {
		signedIn: state.signedIn,
		organizationId: state.profile
			? state.profile.organizationId
			: (previous?.organizationId ?? null),
	};
}

export async function activateModels(sdk: PluginSdk, options: ModelsOptions): Promise<void> {
	const now = options.now ?? Date.now;
	const emptyListRetryMs = options.emptyListRetryMs ?? 1_000;
	const preferences = openModelPreferences(mainHost(sdk).storage);

	let gatewayRead: Promise<void> | undefined;
	let reading: Promise<void> | undefined;
	let readAgain = false;
	/** A read is waiting for the server, so the server becoming ready needs no read of its own. */
	let connecting = false;
	let startServerOnNextRead = false;
	let emptyListReads = 0;
	/** Counts changes of signed-in account or organisation, to tell which read settles one. */
	let accountChanges = 0;
	let emptyListTimer: ReturnType<typeof setTimeout> | undefined;
	sdk.onDispose(() => clearTimeout(emptyListTimer));

	const initialState: ModelsState = {
		ready: false,
		followingAccount: false,
		aiProviders: {},
		models: {},
		defaults: {},
		preferences: preferences.snapshot(),
		gatewayCatalog: { details: [], fetchedAt: null },
	};

	const models = sdk.domainObjects.provide(Models, {
		initialState,
		methods: {
			refresh: () => readAiProviders(true),
			refreshGatewayCatalog: (): Promise<void> | undefined => {
				const { fetchedAt } = models.state.gatewayCatalog;
				if (fetchedAt !== null && now() - fetchedAt < GATEWAY_CATALOG_FRESH_MS) return;
				gatewayRead ??= fetchGatewayModelDetails(options.fetch)
					.then((details) =>
						models.update((state) => ({ ...state, gatewayCatalog: { details, fetchedAt: now() } })),
					)
					.finally(() => {
						gatewayRead = undefined;
					});
				return gatewayRead;
			},
			remember: (input) => setPreferences(preferences.remember(input)),
			recordRecent: (model) => setPreferences(preferences.recordRecent(model)),
			setFavorite: ({ favorite, ...model }) =>
				setPreferences(preferences.setFavorite(model, favorite)),
			setAutoFreeModels: ({ enabled }) => setPreferences(preferences.setAutoFreeModels(enabled)),
			connectAiProvider: async ({ aiProviderId, apiKey }, caller) => {
				assertCredentialCaller(caller);
				assertManagedHere(aiProviderId);
				await mutate((client) => connectAiProvider(client, aiProviderId, apiKey));
			},
			disconnectAiProvider: async ({ aiProviderId }, caller) => {
				assertCredentialCaller(caller);
				assertManagedHere(aiProviderId);
				await mutate((client) => disconnectAiProvider(client, aiProviderId));
			},
			saveCustomAiProvider: async (provider, caller) => {
				assertCredentialCaller(caller);
				assertManagedHere(provider.aiProviderId);
				const existing = models.state.aiProviders[provider.aiProviderId];
				if (existing && existing.source !== "custom") {
					throw new KernelError(
						"CONFLICT",
						`"${provider.aiProviderId}" is already an AI provider; choose another id.`,
					);
				}
				await mutate((client) => saveCustomAiProvider(client, provider));
			},
			customAiProvider: async ({ aiProviderId }, caller) => {
				assertCredentialCaller(caller);
				return readCustomAiProvider(await connectClient(), aiProviderId);
			},
			presentEnv: ({ names }, caller) => {
				assertCredentialCaller(caller);
				return { names: presentEnvNames(names, options.env) };
			},
		},
	});

	let watching: AbortController | undefined;
	sdk.onDispose(() => stopWatching());
	followServer();
	followAccount();
	followAiProviderContributions();

	function setPreferences(next: ModelsState["preferences"]): void {
		models.update((state) => ({ ...state, preferences: next }));
	}

	function contributedAiProviders(): Set<string> {
		return new Set(
			sdk.extensions
				.list(AiProviderPoint)
				.map((contribution) => contribution.metadata.aiProviderId),
		);
	}

	function assertManagedHere(aiProviderId: string): void {
		if (aiProviderId === KILO_AI_PROVIDER_ID) {
			throw new KernelError("BUSINESS", "Kilo's gateway is connected by signing in to Kilo.");
		}
		if (contributedAiProviders().has(aiProviderId)) {
			throw new KernelError(
				"BUSINESS",
				`"${aiProviderId}" is managed by the plugin that provides it.`,
			);
		}
	}

	async function connectClient(): Promise<KiloModelsClient> {
		const server = sdk.domainObjects.get(KiloServer);
		if (!server) throw new KernelError("UNAVAILABLE", "The Kilo server isn't available.");
		return options.createClient(await server.methods.connect(undefined));
	}

	async function mutate(change: (client: KiloModelsClient) => Promise<void>): Promise<void> {
		await change(await connectClient());
		await readAiProviders(true).catch((error: unknown) => {
			sdk.logger.warn("Could not read the AI providers after a change", error);
		});
	}

	/** Coalesces reads: one at a time, and one more after it for triggers that came during it. */
	function readAiProviders(startServer: boolean): Promise<void> {
		startServerOnNextRead ||= startServer;
		if (reading) {
			readAgain = true;
			return reading;
		}
		reading = (async () => {
			try {
				let failure: unknown;
				do {
					readAgain = false;
					const start = startServerOnNextRead;
					startServerOnNextRead = false;
					failure = await readOnce(start, accountChanges).then(
						() => undefined,
						(error: unknown) => error ?? new Error("The AI providers could not be read."),
					);
				} while (readAgain);
				if (failure) throw failure;
			} finally {
				reading = undefined;
			}
		})();
		return reading;
	}

	/** `forAccount` is the account change it reads for; a later change keeps following. */
	async function readOnce(startServer: boolean, forAccount: number): Promise<void> {
		const server = sdk.domainObjects.get(KiloServer);
		if (!startServer && server?.getState().status !== "ready") return;
		connecting = true;
		const client = await connectClient().finally(() => {
			connecting = false;
		});
		const [catalog, config] = await Promise.all([client.readCatalog(), client.readGlobalConfig()]);
		// Kilo fills its catalog in after startup, so an empty first answer is read again.
		if (catalog.models.length === 0 && emptyListReads < EMPTY_LIST_RETRIES) {
			emptyListReads += 1;
			clearTimeout(emptyListTimer);
			emptyListTimer = setTimeout(readAutomatically, emptyListRetryMs);
			return;
		}
		emptyListReads = 0;
		const mapped = mapAiProviderList({ catalog, config, contributed: contributedAiProviders() });
		models.update(({ configuredModel: _previous, ...state }) => ({
			...state,
			ready: true,
			followingAccount: state.followingAccount && forAccount !== accountChanges,
			...mapped,
		}));
	}

	function readAutomatically(): void {
		readAiProviders(false).catch((error: unknown) => {
			sdk.logger.warn("Could not read the AI providers", error);
		});
	}

	function followServer(): void {
		sdk.domainObjects.track(KiloServer, {
			added(server) {
				let status = server.getState().status;
				if (status === "ready") {
					readAutomatically();
					watchCatalog();
				}
				server.subscribe((next) => {
					const becameReady = next.status === "ready" && status !== "ready";
					status = next.status;
					if (next.status !== "ready") stopWatching();
					if (!becameReady) return;
					if (!connecting) readAutomatically();
					watchCatalog();
				});
			},
			removed: stopWatching,
		});
	}

	function stopWatching(): void {
		watching?.abort();
		watching = undefined;
	}

	/** Kilo fills its catalog in after startup and on credential changes; each change is read again. */
	function watchCatalog(): void {
		stopWatching();
		const controller = new AbortController();
		watching = controller;
		void connectClient()
			.then((client) => client.watchCatalog(readAutomatically, controller.signal))
			.catch((error: unknown) => {
				if (!controller.signal.aborted) sdk.logger.warn("Stopped following Kilo's catalog", error);
			});
	}

	function followAccount(): void {
		sdk.domainObjects.track(KiloAccount, {
			added(account) {
				let key = accountKey(account.getState(), undefined);
				account.subscribe((state) => {
					const next = accountKey(state, key);
					if (next.signedIn === key.signedIn && next.organizationId === key.organizationId) return;
					key = next;
					// Synchronously: see the design comment.
					accountChanges += 1;
					models.update((current) => ({ ...current, followingAccount: true }));
					readAutomatically();
				});
			},
			removed() {},
		});
	}

	function followAiProviderContributions(): void {
		let contributed = [...contributedAiProviders()].toSorted().join("\n");
		sdk.extensions.subscribe(AiProviderPoint, () => {
			const next = [...contributedAiProviders()].toSorted().join("\n");
			if (next === contributed) return;
			contributed = next;
			readAutomatically();
		});
	}
}
