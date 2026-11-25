// Test host for kilo.local-inference's window: main and a window linked in
// memory, with `local-models` and `model-server` answered by the test's
// handlers (main's real entry needs Node), and stand-ins under their real
// manifests and definitions for kilo.core (its account and `signedIn` key),
// kilo.shell (its points and navigation), kilo.chat (its `model-source`
// point) and kilo.work-sessions (which kilo.chat requires); the kernel's
// flags (`flagOverrides`), a telemetry sink with consent, and its os and
// clipboard. `model-server`'s `catalog` stands in for a `model-catalog`
// contribution titled "Anaconda".
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { page } from "vitest/browser";

import {
	definePlugin,
	KernelClipboard,
	KernelDataCollection,
	KernelError,
	KernelOs,
	KernelTelemetrySink,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestHost, createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	KiloAccount,
	type AccountState,
} from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { Navigation, SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import {
	LOCAL_INFERENCE_DEFINITIONS,
	LocalModels,
	MODEL_CATALOG_FLAG,
	ModelServer,
	type LocalInferenceStatus,
	type LocalModel,
	type LocalModelsState,
	type ModelCatalogState,
	type ModelDownload,
	type ModelServerState,
} from "../contracts/index";

/** Origin's channel keys, by method. */
const ORIGIN_KEYS: Readonly<Record<string, string>> = {
	status: "status.get",
	listModels: "models.list",
	addModel: "models.add",
	removeModel: "models.remove",
	updateModel: "models.update",
	prepare: "models.prepare",
	connect: "runtime.connect",
	disconnect: "runtime.disconnect",
	retry: "runtime.retry",
	settings: "settings.get",
	updateSettings: "settings.update",
	usage: "usage.get",
	hardwareProfile: "hardware.profile",
	listCatalog: "catalog.list",
	listDownloads: "catalog.downloads.list",
	startDownload: "catalog.download.start",
	cancelDownload: "catalog.download.cancel",
};

// oxlint-disable-next-line no-explicit-any -- handlers are typed by the test that supplies them
type Handler = (input: any) => unknown;

export const SIGNED_IN: AccountState = {
	connection: "connected",
	signedIn: true,
	profile: null,
	profileError: null,
	signInExpired: false,
	deviceSignIn: { status: "idle" },
	organizationError: null,
	refreshing: false,
	switchingOrganization: false,
};

export const SIGNED_OUT: AccountState = { ...SIGNED_IN, signedIn: false };

/** The stand-in `model-catalog` contribution: Anaconda's, signed in. */
export const ANACONDA_CATALOG: NonNullable<ModelCatalogState> = {
	title: "Anaconda",
	access: { status: "signed-in", accountKey: "test-user" },
};

export const usageSnapshot = {
	system: {
		cpuPercent: 48.4,
		cpuSpeedGHz: 3.5,
		gpuMemoryUsedBytes: 4 * 1024 ** 3,
		gpuMemoryTotalBytes: 8 * 1024 ** 3,
		memoryUsedBytes: 10 * 1024 ** 3,
		memoryTotalBytes: 16 * 1024 ** 3,
	},
};

export const connection = {
	baseUrl: "http://127.0.0.1:59632/v1",
	port: 59_632,
	apiKey: "local-secret",
};

/** A telemetry event as a sink received it: its declared name and data. */
export interface TrackedEvent {
	readonly event: string;
	readonly data: Readonly<Record<string, unknown>>;
}

export type LocalInferenceHostState = Partial<LocalModelsState & ModelServerState>;

export interface LocalInferenceHostOptions {
	/** Method fakes, keyed by method (`listModels`) or origin's key (`models.list`). */
	readonly handlers?: Readonly<Record<string, Handler>>;
	/** kilo.core's account (signed in by default); null leaves it unprovided. */
	readonly identity?: AccountState | null;
	/** Flag overrides; the model catalog is on unless set. */
	readonly flags?: Readonly<Record<string, boolean | string | number>>;
	/** The window's route search (`{ catalogModel }` for a deep link). */
	readonly search?: Record<string, string>;
	readonly pathForFile?: (file: File) => string | null;
	/** The domain objects' first state; `catalog` is Anaconda's, signed in, unless set. */
	readonly initialState?: LocalInferenceHostState;
	/** kilo.local-inference's renderer entry (an empty one by default). */
	readonly webEntry?: PluginEntry;
	readonly plugins?: readonly PluginRegistration[];
	readonly logger?: KernelLogger;
}

function asKernelError(error: unknown): KernelError {
	if (error instanceof KernelError) return error;
	return new KernelError("BUSINESS", error instanceof Error ? error.message : String(error));
}

const MAIN_WINDOW = "main";

/**
 * kilo.local-inference's window on a real kernel pair: the domain objects
 * from `handlers` (lists default to empty; anything else missing rejects),
 * kilo.shell's navigation, kilo.core's account, the kernel's flags,
 * telemetry, os and clipboard.
 */
export async function bootLocalInferenceHost(options: LocalInferenceHostOptions = {}) {
	cleanup();
	const handlers: Record<string, Handler> = { ...options.handlers };
	const empty = async () => [];
	const tracked: TrackedEvent[] = [];
	const navigations: { path: string; search: Record<string, string> }[] = [];
	const settingsOpened: (string | undefined)[] = [];
	const showItemInFolder = vi.fn((_input: { path: string }) => undefined);
	const writeText = vi.fn((_input: { text: string }) => undefined);
	let models!: DomainObjectProvider<typeof LocalModels>;
	let server!: DomainObjectProvider<typeof ModelServer>;
	const accountState = options.identity === undefined ? SIGNED_IN : options.identity;

	const handlerFor = (method: string): Handler | undefined =>
		handlers[method] ??
		handlers[ORIGIN_KEYS[method] ?? ""] ??
		(method === "listModels" || method === "listDownloads" ? empty : undefined);

	const methodsFor = (definition: { readonly methods: object }) =>
		Object.fromEntries(
			Object.keys(definition.methods).map((method) => [
				method,
				async (input: unknown) => {
					const handler = handlerFor(method);
					if (!handler) throw new KernelError("NOT_FOUND", `${method} is not implemented in test`);
					try {
						return await handler(input);
					} catch (error) {
						throw asKernelError(error);
					}
				},
			]),
		) as never;

	const localInferenceMain = definePlugin({
		activate(sdk) {
			const initial = options.initialState ?? {};
			models = sdk.domainObjects.provide(LocalModels, {
				initialState: { models: initial.models ?? [] },
				methods: methodsFor(LocalModels),
			});
			server = sdk.domainObjects.provide(ModelServer, {
				initialState: {
					status: initial.status ?? { status: "idle" },
					downloads: initial.downloads ?? [],
					catalog: initial.catalog === undefined ? ANACONDA_CATALOG : initial.catalog,
				},
				methods: methodsFor(ModelServer),
			});
		},
	});

	const coreMain = definePlugin({
		activate(sdk) {
			if (!accountState) return;
			const unused = () => undefined;
			sdk.context.set("signedIn", accountState.signedIn === true);
			sdk.domainObjects.provide(KiloAccount, {
				initialState: accountState,
				methods: {
					signIn: () => ({ signedIn: false }),
					cancelSignIn: unused,
					signOut: unused,
					refresh: unused,
					setOrganization: unused,
				},
			});
		},
	});

	const shellMain = definePlugin({
		activate(sdk) {
			const navigation = sdk.domainObjects.provide(Navigation, {
				initialState: {
					windows: {
						[MAIN_WINDOW]: { path: "/settings/local-model-server", search: options.search ?? {} },
					},
				},
				methods: {
					navigate: ({ path, search = {}, windowId = MAIN_WINDOW }) => {
						navigations.push({ path, search });
						navigation.update((state) => ({
							windows: { ...state.windows, [windowId]: { path, search } },
						}));
					},
					openSettings: ({ section }) => void settingsOpened.push(section),
					goHome: () => undefined,
					openDialog: () => undefined,
					reportLocation: () => undefined,
				},
			});
		},
	});

	const telemetrySink = testPlugin("test.telemetry-sink", {
		manifest: { contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: ({ name, data }) => void tracked.push({ event: name, data }),
				});
			},
		},
	});

	const core: PluginRegistration = { manifest: coreManifest, definitions: CORE_DEFINITIONS };
	const shell: PluginRegistration = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const workSessions: PluginRegistration = {
		manifest: workSessionsManifest,
		definitions: WORK_SESSIONS_DEFINITIONS,
	};
	const chat: PluginRegistration = { manifest: chatManifest, definitions: CHAT_DEFINITIONS };
	const { main, renderer } = await createTestKernelPair({
		host: createTestHost({ flagOverrides: { [MODEL_CATALOG_FLAG]: true, ...options.flags } }),
		main: [
			{ ...core, entry: coreMain },
			{ ...shell, entry: shellMain },
			workSessions,
			chat,
			telemetrySink,
			...(options.plugins ?? []),
			{ manifest, definitions: LOCAL_INFERENCE_DEFINITIONS, entry: localInferenceMain },
		],
		renderer: [
			core,
			shell,
			workSessions,
			chat,
			...(options.plugins ?? []).map(({ entry: _entry, ...registration }) => registration),
			{
				manifest,
				definitions: LOCAL_INFERENCE_DEFINITIONS,
				// Always a window entry: main only takes window calls from plugins that run there.
				entry: options.webEntry ?? definePlugin({ activate: () => {} }),
			},
		],
		...(options.pathForFile ? { pathForFile: options.pathForFile } : {}),
		...(options.logger ? { logger: options.logger } : {}),
	});
	main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: () => true,
			showItemInFolder: (input) => showItemInFolder(input),
			showLogs: () => ({ revealed: true }),
			logFilePath: () => "/logs/main.log",
		},
	});
	main.kernelSdk.domainObjects.provide(KernelClipboard, {
		initialState: {},
		methods: { writeText: (input) => writeText(input) },
	});
	main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "test" },
		methods: { setChoice: () => {} },
	});
	await main.flush();

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrap = (element: ReactNode) => (
		<KernelProvider kernel={renderer} as={manifest.id}>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>{element}</TooltipProvider>
			</QueryClientProvider>
		</KernelProvider>
	);
	const update = (patch: LocalInferenceHostState) =>
		act(async () => {
			if (patch.models !== undefined) models.setState({ models: patch.models });
			const { models: _models, ...serverPatch } = patch;
			if (Object.keys(serverPatch).length > 0) {
				server.setState({ ...server.state, ...serverPatch });
			}
			await main.flush();
		});

	return {
		main,
		renderer,
		queryClient,
		tracked,
		navigations,
		settingsOpened,
		showItemInFolder,
		writeText,
		wrap,
		render: (element: ReactNode) => render(wrap(element)),
		/** Main changed the domain objects' state. */
		update,
		/** `model-server`'s provider, for handlers that change its state as main would. */
		get modelServer() {
			return server;
		},
		/** Main's server status changed (origin's `status-changed`). */
		setStatus: (status: LocalInferenceStatus) => update({ status }),
		/** Main's registry changed (origin's `models-changed`). */
		setModels: (next: LocalModel[]) => update({ models: next }),
		/** The `model-catalog` contribution's access changed. */
		setCatalog: (catalog: ModelCatalogState) => update({ catalog }),
		/** A catalog download progressed (origin's `catalog-download-changed`). */
		emitDownload: (download: ModelDownload) =>
			update({
				downloads: [
					...server.state.downloads.filter(
						(entry) =>
							entry.modelId !== download.modelId ||
							entry.quantizationId !== download.quantizationId,
					),
					download,
				],
			}),
	};
}

export type LocalInferenceHost = Awaited<ReturnType<typeof bootLocalInferenceHost>>;

/** Boots a host and renders `element` in it. */
export async function renderWithLocalInference(
	element: ReactNode,
	options: LocalInferenceHostOptions = {},
) {
	const host = await bootLocalInferenceHost(options);
	return { ...host.render(element), host };
}

export async function expandModel(baseElement: HTMLElement, modelId: string) {
	const trigger = page.elementLocator(baseElement).getByTestId(`local-model-trigger-${modelId}`);
	await trigger.click();
	return page.elementLocator(baseElement).getByTestId(`local-model-details-${modelId}`);
}
