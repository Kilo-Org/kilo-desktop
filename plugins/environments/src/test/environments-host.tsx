// Test host for kilo.environments' window: main and a window linked in
// memory, with `kilo.environments/conda` answered by the test's handlers
// (main's real entry needs the bridge), and stand-ins under their real
// manifests and definitions for kilo.shell (its points and navigation) and,
// when `identity` is given, kilo.core (its account and `signedIn` key); the
// kernel's flags (`flags`) and a telemetry sink with consent.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	definePlugin,
	KernelDataCollection,
	KernelError,
	KernelTelemetrySink,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestHost, createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	KiloAccount,
	type AccountState,
} from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { Navigation, SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import {
	Conda,
	ENVIRONMENTS_DEFINITIONS,
	type CondaStatus,
	type JobProgressEvent,
} from "../contracts/index";

/** Origin's conda contract keys, by `kilo.environments/conda` method. */
const ORIGIN_KEYS: Readonly<Record<string, string>> = {
	listEnvironments: "conda.envs.list",
	distributions: "conda.envs.distributions",
	createEnvironment: "conda.envs.create",
	cloneEnvironment: "conda.envs.clone",
	createEnvironmentFromFile: "conda.envs.createFromFile",
	deleteEnvironment: "conda.envs.delete",
	pickEnvironmentFile: "conda.envs.pickFile",
	readEnvironmentFile: "conda.envs.readFile",
	prefixOptions: "conda.envs.prefixOptions",
	checkPrefix: "conda.envs.checkPrefix",
	listPackages: "conda.packages.list",
	installPackages: "conda.packages.install",
	removePackages: "conda.packages.remove",
	updatePackages: "conda.packages.update",
	previewUpdate: "conda.packages.preview",
	previewInstall: "conda.packages.previewInstall",
	listChannels: "conda.channels.list",
	addChannel: "conda.channels.add",
	removeChannel: "conda.channels.remove",
	resolveChannel: "conda.channels.resolve",
	findRepodata: "conda.repodata.find",
	cancelJob: "conda.jobs.cancel",
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

/** A telemetry event as a sink received it: its declared name and data. */
export interface TrackedEvent {
	readonly event: string;
	readonly data: Readonly<Record<string, unknown>>;
}

export interface EnvironmentsHostOptions {
	/** Conda method fakes, keyed by method (`listEnvironments`) or origin's key (`conda.envs.list`). */
	readonly handlers?: Readonly<Record<string, Handler>>;
	readonly status?: CondaStatus;
	/** kilo.core's account; without it there is no kilo.core. */
	readonly identity?: AccountState;
	/** Flag overrides (`environments-feature` is off unless set). */
	readonly flags?: Readonly<Record<string, boolean | string | number>>;
	/** The window's route search (`{ env }`, or an install link's `{ packageAction, package, … }`). */
	readonly search?: Record<string, string>;
	readonly navigate?: (path: string, options: { search: Record<string, string> }) => void;
	/** False keeps the route where it was when navigating (default true). */
	readonly followNavigation?: boolean;
	/** Receives each event a telemetry sink gets, by its declared name. */
	readonly track?: (input: TrackedEvent) => unknown;
	readonly pathForFile?: (file: File) => string | null;
	/** kilo.environments' renderer entry (an empty one by default). */
	readonly webEntry?: PluginEntry;
	/** Extra plugins, registered in both processes (their entries in main only). */
	readonly plugins?: readonly PluginRegistration[];
	readonly logger?: KernelLogger;
}

function asKernelError(error: unknown): KernelError {
	if (error instanceof KernelError) return error;
	return new KernelError("BUSINESS", error instanceof Error ? error.message : String(error));
}

const MAIN_WINDOW = "main";

/**
 * kilo.environments' window on a real kernel pair: `kilo.environments/conda`
 * from `handlers` (a missing one rejects), kilo.shell's navigation, the
 * kernel's flags and telemetry, and optionally kilo.core's account.
 */
export async function bootEnvironmentsHost(options: EnvironmentsHostOptions = {}) {
	cleanup();
	const handlers = options.handlers ?? {};
	const navigations: { path: string; search: Record<string, string> }[] = [];
	const settingsOpened: (string | undefined)[] = [];
	const tracked: TrackedEvent[] = [];
	let conda!: DomainObjectProvider<typeof Conda>;

	const handlerFor = (method: string): Handler | undefined =>
		handlers[method] ?? handlers[ORIGIN_KEYS[method] ?? ""];

	const environmentsMain = definePlugin({
		activate(sdk) {
			conda = sdk.domainObjects.provide(Conda, {
				initialState: { status: options.status ?? "ready" },
				methods: Object.fromEntries(
					Object.keys(Conda.methods).map((method) => [
						method,
						async (input: unknown) => {
							const handler = handlerFor(method);
							if (!handler)
								throw new KernelError("NOT_FOUND", `${method} is not implemented in test`);
							try {
								return await handler(input);
							} catch (error) {
								throw asKernelError(error);
							}
						},
					]),
				) as never,
			});
		},
	});

	const coreMain = definePlugin({
		activate(sdk) {
			if (!options.identity) return;
			const unused = () => undefined;
			sdk.context.set("signedIn", options.identity.signedIn === true);
			sdk.domainObjects.provide(KiloAccount, {
				initialState: options.identity,
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
						[MAIN_WINDOW]: { path: "/settings/environments", search: options.search ?? {} },
					},
				},
				methods: {
					navigate: ({ path, search = {}, windowId = MAIN_WINDOW }) => {
						navigations.push({ path, search });
						options.navigate?.(path, { search });
						if (options.followNavigation === false) return;
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
					deliver: async ({ name, data }) => {
						const event = { event: name, data };
						tracked.push(event);
						await options.track?.(event);
					},
				});
			},
		},
	});

	const shell: PluginRegistration = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const core: PluginRegistration = { manifest: coreManifest, definitions: CORE_DEFINITIONS };
	const plugins = options.plugins ?? [];
	const { main, renderer } = await createTestKernelPair({
		host: createTestHost({ flagOverrides: { ...options.flags } }),
		main: [
			{ ...shell, entry: shellMain },
			...(options.identity ? [{ ...core, entry: coreMain }] : []),
			telemetrySink,
			...plugins,
			{ manifest, definitions: ENVIRONMENTS_DEFINITIONS, entry: environmentsMain },
		],
		renderer: [
			shell,
			...(options.identity ? [core] : []),
			...plugins.map(({ entry: _entry, ...registration }) => registration),
			{
				manifest,
				definitions: ENVIRONMENTS_DEFINITIONS,
				// Always a window entry: main only takes window calls from plugins that run there.
				entry: options.webEntry ?? definePlugin({ activate: () => {} }),
			},
		],
		...(options.pathForFile ? { pathForFile: options.pathForFile } : {}),
		...(options.logger ? { logger: options.logger } : {}),
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
				<TooltipProvider>
					<SidebarProvider>{element}</SidebarProvider>
				</TooltipProvider>
			</QueryClientProvider>
		</KernelProvider>
	);

	return {
		main,
		renderer,
		queryClient,
		navigations,
		settingsOpened,
		tracked,
		wrap,
		render: (element: ReactNode) => render(wrap(element)),
		/** Publishes a job's progress, as the queue in main does. */
		emitProgress: (event: JobProgressEvent) =>
			act(async () => {
				conda.emit("job-progress", event);
				await main.flush();
			}),
		setStatus: (status: CondaStatus) =>
			act(async () => {
				conda.setState({ status });
				await main.flush();
			}),
	};
}

export type EnvironmentsHost = Awaited<ReturnType<typeof bootEnvironmentsHost>>;

/** Boots a host and renders `element` in it. */
export async function renderWithConda(element: ReactNode, options: EnvironmentsHostOptions = {}) {
	const host = await bootEnvironmentsHost(options);
	return { ...host.render(element), host };
}
