import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { page } from "vitest/browser";

import {
	definePlugin,
	KernelClipboard,
	KernelError,
	KernelOs,
	type DomainProvider,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import accountManifest from "@kilo-desktop/plugin-account/plugin.json";
import {
	ACCOUNT_DEFINITIONS,
	Identity,
	type IdentityState,
} from "@kilo-desktop/plugin-account/contracts";
import flagsManifest from "@kilo-desktop/plugin-flags/plugin.json";
import { Flags, FLAGS_DEFINITIONS } from "@kilo-desktop/plugin-flags/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	Navigation,
	SHELL_DOMAINS,
	SHELL_EXTENSION_POINTS,
} from "@kilo-desktop/plugin-shell/contracts";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { Telemetry, TELEMETRY_DEFINITIONS } from "@kilo-desktop/plugin-telemetry/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import {
	LOCAL_INFERENCE_DEFINITIONS,
	LocalInference,
	MODEL_CATALOG_FLAG,
	type LocalInferenceState,
	type LocalInferenceStatus,
	type LocalModel,
	type ModelDownload,
} from "../contracts/index.js";

/** Origin's channel keys, by `kilo.local-inference/local-inference` method. */
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

export const SIGNED_IN: IdentityState = {
	connection: "connected",
	authenticated: true,
	profile: null,
	profileError: null,
	deviceAuth: { status: "idle" },
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

export const SIGNED_OUT: IdentityState = { ...SIGNED_IN, authenticated: false };

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

export interface LocalInferenceHostOptions {
	/** Method fakes, keyed by method (`listModels`) or origin's key (`models.list`). */
	readonly handlers?: Readonly<Record<string, Handler>>;
	/** kilo.account's identity (signed in by default). */
	readonly identity?: IdentityState;
	/** kilo.flags' flags; the model catalog is on unless set. */
	readonly flags?: Readonly<Record<string, unknown>>;
	/** The window's route search (`{ catalogModel }` for a deep link). */
	readonly search?: Record<string, string>;
	readonly pathForFile?: (file: File) => string | null;
	readonly initialState?: Partial<LocalInferenceState>;
	/** kilo.local-inference's renderer entry (an empty one by default). */
	readonly webEntry?: PluginEntry;
	readonly plugins?: readonly PluginRegistration[];
	/** Plugins whose entry runs in main only (the window gets their manifest and definitions). */
	readonly mainPlugins?: readonly PluginRegistration[];
}

function asKernelError(error: unknown): KernelError {
	if (error instanceof KernelError) return error;
	return new KernelError("BUSINESS", error instanceof Error ? error.message : String(error));
}

/**
 * kilo.local-inference's window on a real kernel pair: the domain object
 * from `handlers` (lists default to empty; anything else missing rejects),
 * kilo.shell's navigation, telemetry, flags, kilo.account's identity, and the
 * kernel's shell and clipboard.
 */
export async function bootLocalInferenceHost(options: LocalInferenceHostOptions = {}) {
	cleanup();
	const handlers: Record<string, Handler> = { ...options.handlers };
	const empty = async () => [];
	const tracked: { event: string; data: Record<string, unknown> }[] = [];
	const navigations: { path: string; search: Record<string, string> }[] = [];
	const settingsOpened: (string | undefined)[] = [];
	const showItemInFolder = vi.fn((_input: { path: string }) => undefined);
	const writeText = vi.fn((_input: { text: string }) => undefined);
	let domain!: DomainProvider<typeof LocalInference>;
	let identity!: DomainProvider<typeof Identity>;

	const handlerFor = (method: string): Handler | undefined =>
		handlers[method] ??
		handlers[ORIGIN_KEYS[method] ?? ""] ??
		(method === "listModels" || method === "listDownloads" ? empty : undefined);

	const localInferenceMain = definePlugin({
		activate(sdk) {
			domain = sdk.domains.provide(LocalInference, {
				initialState: {
					status: { status: "idle" },
					models: [],
					downloads: [],
					...options.initialState,
				},
				methods: new Proxy({} as Record<string, Handler>, {
					get: (_target, method: string) => async (input: unknown) => {
						const handler = handlerFor(method);
						if (!handler)
							throw new KernelError("NOT_FOUND", `${method} is not implemented in test`);
						try {
							return await handler(input);
						} catch (error) {
							throw asKernelError(error);
						}
					},
				}) as never,
			});
		},
	});

	const supportMain = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Telemetry, {
				initialState: {},
				methods: {
					track: async (input) => {
						tracked.push(input);
					},
				},
			});
		},
	});

	const flagsMain = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Flags, {
				initialState: {
					flags: { [MODEL_CATALOG_FLAG]: true, ...options.flags },
					ready: true,
				},
				methods: {},
			});
		},
	});

	const accountMain = definePlugin({
		activate(sdk) {
			const unused = () => undefined;
			identity = sdk.domains.provide(Identity, {
				initialState: options.identity ?? SIGNED_IN,
				methods: {
					signIn: () => ({ signedIn: false }),
					cancelSignIn: unused,
					signOut: unused,
					refresh: unused,
					setOrganization: unused,
					dismissOrgError: unused,
				},
			});
		},
	});

	const shellWeb = definePlugin({
		activate(sdk) {
			const navigation = sdk.domains.provide(Navigation, {
				initialState: { path: "/settings/local-model-server", search: options.search ?? {} },
				methods: {
					navigate: ({ path, search = {} }) => {
						navigations.push({ path, search });
						navigation.setState({ path, search });
					},
					openSettings: ({ section }) => void settingsOpened.push(section),
					goHome: () => undefined,
				},
			});
		},
	});

	const shell = {
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	};
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS, entry: supportMain },
			{ manifest: flagsManifest, definitions: FLAGS_DEFINITIONS, entry: flagsMain },
			{ manifest: accountManifest, definitions: ACCOUNT_DEFINITIONS, entry: accountMain },
			...(options.plugins ?? []),
			...(options.mainPlugins ?? []),
			{ manifest, definitions: LOCAL_INFERENCE_DEFINITIONS, entry: localInferenceMain },
		],
		renderer: [
			{ ...shell, entry: shellWeb },
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS },
			{ manifest: flagsManifest, definitions: FLAGS_DEFINITIONS },
			{ manifest: accountManifest, definitions: ACCOUNT_DEFINITIONS },
			...(options.plugins ?? []),
			...(options.mainPlugins ?? []).map(({ entry: _entry, ...registration }) => registration),
			{
				manifest,
				definitions: LOCAL_INFERENCE_DEFINITIONS,
				// Always a window entry: main only takes window calls from plugins that run there.
				entry: options.webEntry ?? definePlugin({ activate: () => {} }),
			},
		],
		...(options.pathForFile ? { pathForFile: options.pathForFile } : {}),
	});
	main.kernelSdk.domains.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: () => true,
			showItemInFolder: (input) => showItemInFolder(input),
			showLogs: () => ({ revealed: true }),
			logFilePath: () => "/logs/main.log",
		},
	});
	main.kernelSdk.domains.provide(KernelClipboard, {
		initialState: {},
		methods: { writeText: (input) => writeText(input) },
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
	const update = (patch: Partial<LocalInferenceState>) =>
		act(async () => {
			domain.setState({ ...domain.state, ...patch });
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
		/** Main changed the domain object's state. */
		update,
		/** Main's server status changed (origin's `status-changed`). */
		setStatus: (status: LocalInferenceStatus) => update({ status }),
		/** Main's registry changed (origin's `models-changed`). */
		setModels: (models: LocalModel[]) => update({ models }),
		/** A catalog download progressed (origin's `catalog-download-changed`). */
		emitDownload: (download: ModelDownload) =>
			update({
				downloads: [
					...domain.state.downloads.filter(
						(entry) =>
							entry.modelId !== download.modelId ||
							entry.quantizationId !== download.quantizationId,
					),
					download,
				],
			}),
		setIdentity: (next: IdentityState) =>
			act(async () => {
				identity.setState(next);
				await main.flush();
			}),
		/** The agent asked for the settings section. */
		requestSettings: () =>
			act(async () => {
				domain.emit("settings-requested", {});
				await main.flush();
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
