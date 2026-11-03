// Test host for kilo.notebook's web entry: main and a window linked in memory,
// with `kilo.notebook/notebooks` answered by the test (main's real entry needs
// Node), stand-ins for kilo.sessions (panes and openers), kilo.account's
// identity and kilo.shell's theme. Panes render as kilo.workbench's canvas
// renders them.
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	definePlugin,
	type DomainProvider,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import accountManifest from "@kilo-desktop/plugin-account/plugin.json";
import {
	ACCOUNT_DEFINITIONS,
	Identity,
	type IdentityState,
} from "@kilo-desktop/plugin-account/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	PaneKind,
	SESSIONS_DEFINITIONS,
	type Pane,
	type PaneImplementation,
	type PaneProps,
} from "@kilo-desktop/plugin-sessions/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	SettingsSection,
	SHELL_DOMAINS,
	SHELL_EXTENSION_POINTS,
	Theme,
	type SettingsSectionImplementation,
} from "@kilo-desktop/plugin-shell/contracts";
import { SettingsSectionProvider } from "@kilo-desktop/ui/components/settings-page-header";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import {
	DEFAULT_NOTEBOOK_SETTINGS,
	NOTEBOOK_DEFINITIONS,
	NOTEBOOK_PANE_KIND,
	Notebooks,
	type NotebookEnvironmentPreparation,
	type NotebookSaveResult,
	type NotebookSettings,
	type NotebookStatus,
} from "../contracts/index.js";
import { notebookWebEntry } from "../web/index.js";
import { createSessionsHost, notebookPane, SESSION_ID } from "./sessions-host.js";

export const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";

export const AVAILABLE: NotebookStatus = {
	availability: { status: "available" },
	process: { status: "external" },
	daemon: null,
};

export interface NotebooksFake {
	status?: () => NotebookStatus | Promise<NotebookStatus>;
	save?: (input: { notebookId: string }) => NotebookSaveResult | Promise<NotebookSaveResult>;
	updateSettings?: (patch: {
		autoCreateEnvironmentFile?: boolean | undefined;
		trustNewNotebooks?: boolean | undefined;
	}) => NotebookSettings | Promise<NotebookSettings>;
	prepareEnvironment?: (input: {
		notebookId: string;
		workingDirectory: string;
	}) => NotebookEnvironmentPreparation | Promise<NotebookEnvironmentPreparation>;
	resolvePane?: (input: { sessionId: string; paneId: string }) => void | Promise<void>;
}

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

export interface NotebookHostOptions {
	readonly panes?: readonly Pane[];
	/** kilo.account's identity; without it there is no account plugin. */
	readonly identity?: IdentityState | null;
	readonly mode?: "light" | "dark";
	readonly notebooks?: NotebooksFake;
	readonly settings?: NotebookSettings;
	/** Leaves `kilo.notebook/notebooks` out. */
	readonly withoutMain?: boolean;
}

export async function bootNotebookHost(options: NotebookHostOptions = {}) {
	cleanup();
	const fake = options.notebooks ?? {};
	const calls = {
		status: 0,
		save: [] as unknown[],
		prepare: [] as unknown[],
		resolve: [] as unknown[],
	};
	let notebooks!: DomainProvider<typeof Notebooks>;
	const sessions = createSessionsHost(options.panes ?? [notebookPane("pane_a")]);
	const signIns: unknown[] = [];
	let theme!: DomainProvider<typeof Theme>;
	let identity: DomainProvider<typeof Identity> | undefined;
	const identityState = options.identity === undefined ? SIGNED_IN : options.identity;

	const accountMain: PluginEntry = definePlugin({
		activate(sdk) {
			if (!identityState) return;
			const unused = () => undefined;
			identity = sdk.domains.provide(Identity, {
				initialState: identityState,
				methods: {
					signIn: () => {
						signIns.push(true);
						return { signedIn: false };
					},
					cancelSignIn: unused,
					signOut: unused,
					refresh: unused,
					setOrganization: unused,
					dismissOrgError: unused,
				},
			});
		},
	});
	const shellWeb: PluginEntry = definePlugin({
		activate(sdk) {
			theme = sdk.domains.provide(Theme, {
				initialState: {
					mode: options.mode ?? "light",
					themeId: "kilo",
					accentId: "default",
					terminal: null,
					shiki: "github-light",
				},
				methods: {},
			});
		},
	});
	const shell = {
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	};
	const account: PluginRegistration[] = identityState
		? [{ manifest: accountManifest, definitions: ACCOUNT_DEFINITIONS, entry: accountMain }]
		: [];
	const notebookMain: PluginEntry = definePlugin({
		activate(sdk) {
			notebooks = sdk.domains.provide(Notebooks, {
				initialState: { settings: options.settings ?? DEFAULT_NOTEBOOK_SETTINGS, dirty: {} },
				methods: {
					status: async () => {
						calls.status += 1;
						return (await fake.status?.()) ?? AVAILABLE;
					},
					save: async (input) => {
						calls.save.push(input);
						return (await fake.save?.(input)) ?? { outcome: "saved" };
					},
					updateSettings: async (patch) => {
						const next = (await fake.updateSettings?.(patch)) ?? {
							...notebooks.state.settings,
							...Object.fromEntries(
								Object.entries(patch).filter(([, value]) => value !== undefined),
							),
						};
						notebooks.update((state) => ({ ...state, settings: next }));
						return next;
					},
					prepareEnvironment: async (input) => {
						calls.prepare.push(input);
						return (await fake.prepareEnvironment?.(input)) ?? { outcome: "skipped" };
					},
					resolvePane: async (input) => {
						calls.resolve.push(input);
						await fake.resolvePane?.(input);
					},
				},
			});
		},
	});
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			...account,
			sessions.registration,
			{
				manifest,
				definitions: NOTEBOOK_DEFINITIONS,
				...(options.withoutMain ? {} : { entry: notebookMain }),
			},
		],
		renderer: [
			{ ...shell, entry: shellWeb },
			...(identityState ? [{ manifest: accountManifest, definitions: ACCOUNT_DEFINITIONS }] : []),
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS },
			{ manifest, definitions: NOTEBOOK_DEFINITIONS, entry: notebookWebEntry },
		],
	});
	await main.flush();

	const paneKind = () =>
		renderer.extensions.list(PaneKind).find((candidate) => candidate.key === NOTEBOOK_PANE_KIND)!;
	const settingsSection = () =>
		renderer.extensions
			.list(SettingsSection)
			.find((candidate) => candidate.key === "kilo.notebook/notebooks")!;
	const wrap = (ui: ReactNode) => (
		<KernelProvider kernel={renderer}>
			<TooltipProvider>{ui}</TooltipProvider>
		</KernelProvider>
	);
	const currentPane = (paneId?: string) =>
		sessions.panes().panes.find((pane) => !paneId || pane.id === paneId) ?? notebookPane("pane_a");
	const paneElement = (props: Partial<PaneProps>) => (
		<div style={{ width: 640, height: 480, display: "flex" }}>
			<RenderContribution
				contribution={paneKind()}
				props={{
					sessionId: SESSION_ID,
					pane: currentPane(),
					workspaceId: null,
					directory: null,
					visible: true,
					...props,
				}}
				select={(implementation: PaneImplementation) => implementation.component}
			/>
		</div>
	);

	return {
		main,
		renderer,
		calls,
		sessions,
		signIns,
		paneKind,
		currentPane,
		setDirty: (notebookId: string, dirty: boolean) =>
			act(async () => {
				notebooks.update((state) => ({
					...state,
					dirty: dirty ? { ...state.dirty, [notebookId]: true } : {},
				}));
				await main.flush();
			}),
		sdk: renderer.sdkFor("kilo.notebook"),
		canClose: (pane: Pane) =>
			(paneKind().implementation as PaneImplementation).canClose!({ sessionId: SESSION_ID, pane }),
		setMode: (mode: "light" | "dark") =>
			act(async () => {
				theme.setState({ ...theme.state, mode });
				await main.flush();
			}),
		setIdentity: (next: IdentityState) =>
			act(async () => {
				identity?.setState(next);
				await main.flush();
			}),
		renderPane: (props: Partial<PaneProps> = {}) => {
			const view = render(wrap(paneElement(props)));
			return {
				...view,
				rerenderPane: (next: Partial<PaneProps>) => view.rerender(wrap(paneElement(next))),
			};
		},
		renderSettings: () => {
			const section = settingsSection();
			const Component = (section.implementation as SettingsSectionImplementation).component;
			return render(
				wrap(
					<SettingsSectionProvider
						value={{
							title: section.metadata.title,
							...(section.metadata.description
								? { description: section.metadata.description }
								: {}),
						}}
					>
						<Component />
					</SettingsSectionProvider>,
				),
			);
		},
	};
}

export type NotebookTestHost = Awaited<ReturnType<typeof bootNotebookHost>>;
