import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	definePlugin,
	KernelError,
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
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	Navigation,
	SHELL_DOMAINS,
	SHELL_EXTENSION_POINTS,
} from "@kilo-desktop/plugin-shell/contracts";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { Telemetry, TELEMETRY_DEFINITIONS } from "@kilo-desktop/plugin-telemetry/contracts";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import {
	Conda,
	ENVIRONMENTS_DEFINITIONS,
	type CondaStatus,
	type JobProgressEvent,
} from "../contracts/index.js";

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
	findRepodata: "conda.repodata.find",
	cancelJob: "conda.jobs.cancel",
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

export interface EnvironmentsHostOptions {
	/** Conda method fakes, keyed by method (`listEnvironments`) or origin's key (`conda.envs.list`). */
	readonly handlers?: Readonly<Record<string, Handler>>;
	readonly status?: CondaStatus;
	/** kilo.account's identity; without it there is no account plugin. */
	readonly identity?: IdentityState;
	/** The window's route search (`{ env }` for a deep link). */
	readonly search?: Record<string, string>;
	readonly navigate?: (path: string, options: { search: Record<string, string> }) => void;
	/** False keeps the route where it was when navigating (default true). */
	readonly followNavigation?: boolean;
	readonly track?: (input: { event: string; data: Record<string, unknown> }) => unknown;
	readonly pathForFile?: (file: File) => string | null;
	/** kilo.environments' renderer entry (none by default). */
	readonly webEntry?: PluginEntry;
	/** Extra plugins, registered in both processes. */
	readonly plugins?: readonly PluginRegistration[];
}

function asKernelError(error: unknown): KernelError {
	if (error instanceof KernelError) return error;
	return new KernelError("BUSINESS", error instanceof Error ? error.message : String(error));
}

/**
 * kilo.environments' window on a real kernel pair: `kilo.environments/conda`
 * from `handlers` (a missing one rejects), kilo.shell's navigation, telemetry,
 * and optionally kilo.account's identity.
 */
export async function bootEnvironmentsHost(options: EnvironmentsHostOptions = {}) {
	cleanup();
	const handlers = options.handlers ?? {};
	const navigations: { path: string; search: Record<string, string> }[] = [];
	const settingsOpened: (string | undefined)[] = [];
	const tracked: { event: string; data: Record<string, unknown> }[] = [];
	let conda!: DomainProvider<typeof Conda>;

	const handlerFor = (method: string): Handler | undefined =>
		handlers[method] ?? handlers[ORIGIN_KEYS[method] ?? ""];

	const environmentsMain = definePlugin({
		activate(sdk) {
			conda = sdk.domains.provide(Conda, {
				initialState: { status: options.status ?? "ready" },
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

	const telemetryMain = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Telemetry, {
				initialState: {},
				methods: {
					track: async (input) => {
						tracked.push(input);
						await options.track?.(input);
					},
				},
			});
		},
	});

	const accountMain = definePlugin({
		activate(sdk) {
			if (!options.identity) return;
			const unused = () => undefined;
			sdk.domains.provide(Identity, {
				initialState: options.identity,
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
				initialState: { path: "/settings/environments", search: options.search ?? {} },
				methods: {
					navigate: ({ path, search = {} }) => {
						navigations.push({ path, search });
						options.navigate?.(path, { search });
						if (options.followNavigation !== false) navigation.setState({ path, search });
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
	const account: PluginRegistration[] = options.identity
		? [{ manifest: accountManifest, definitions: ACCOUNT_DEFINITIONS, entry: accountMain }]
		: [];
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS, entry: telemetryMain },
			...account,
			...(options.plugins ?? []),
			{ manifest, definitions: ENVIRONMENTS_DEFINITIONS, entry: environmentsMain },
		],
		renderer: [
			{ ...shell, entry: shellWeb },
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS },
			...(options.identity
				? [{ manifest: accountManifest, definitions: ACCOUNT_DEFINITIONS }]
				: []),
			...(options.plugins ?? []),
			{
				manifest,
				definitions: ENVIRONMENTS_DEFINITIONS,
				...(options.webEntry ? { entry: options.webEntry } : {}),
			},
		],
		...(options.pathForFile ? { pathForFile: options.pathForFile } : {}),
	});
	await main.flush();

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrap = (element: ReactNode) => (
		<KernelProvider kernel={renderer}>
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
		/** The agent asked for Conda Environments settings. */
		requestSetup: () =>
			act(async () => {
				conda.emit("setup-requested", {});
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
