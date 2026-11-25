// Test host for kilo.notebook's web entry: main and a window linked in memory,
// with `kilo.notebook/notebooks` answered by the test (main's real entry needs
// Node), and stand-ins under their real manifests and definitions for
// kilo.work-sessions (panes and openers in main, the window's `window` object
// with `paneTargetActive`), kilo.core's account (and its `signedIn` key),
// kilo.shell's theme and kilo.chat's extension points. Panes render as
// kilo.work-sessions' canvas renders them.
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	definePlugin,
	type DomainObjectProvider,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	KiloAccount,
	type AccountState,
} from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	SettingsSection,
	SHELL_DEFINITIONS,
	Theme,
	type SettingsSectionImplementation,
} from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	PaneKind,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessionsWindow,
	type Pane,
	type PaneImplementation,
	type PaneProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
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
	resolvePane?: (input: { workSessionId: string; paneId: string }) => void | Promise<void>;
}

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

export interface NotebookHostOptions {
	readonly panes?: readonly Pane[];
	/** kilo.core's account; null leaves it unprovided (kilo.core without its account). */
	readonly account?: AccountState | null;
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
	let notebooks!: DomainObjectProvider<typeof Notebooks>;
	const sessions = createSessionsHost(options.panes ?? [notebookPane("pane_a")]);
	const signIns: unknown[] = [];
	const openedPanes: { kind: string }[] = [];
	let theme!: DomainObjectProvider<typeof Theme>;
	let account: DomainObjectProvider<typeof KiloAccount> | undefined;
	let setSignedIn: (signedIn: boolean) => void = () => undefined;
	const accountState = options.account === undefined ? SIGNED_IN : options.account;

	const coreMain: PluginEntry = definePlugin({
		activate(sdk) {
			if (!accountState) return;
			const unused = () => undefined;
			setSignedIn = (signedIn) => sdk.context.set("signedIn", signedIn);
			setSignedIn(accountState.signedIn === true);
			account = sdk.domainObjects.provide(KiloAccount, {
				initialState: accountState,
				methods: {
					signIn: () => {
						signIns.push(true);
						return { signedIn: false };
					},
					cancelSignIn: unused,
					signOut: unused,
					refresh: unused,
					setOrganization: unused,
				},
			});
		},
	});
	const shellWeb: PluginEntry = definePlugin({
		activate(sdk) {
			theme = sdk.domainObjects.provide(Theme, {
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
	const workSessionsWeb: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(WorkSessionsWindow, {
				initialState: {
					focus: null,
					activeWorkSessionId: SESSION_ID,
					view: null,
					detachedViews: [],
				},
				methods: {
					setFocus: () => undefined,
					openWorkSession: () => undefined,
					closeWorkSession: () => undefined,
					showView: () => undefined,
					openPane: (input) => void openedPanes.push(input),
				},
			});
			sdk.context.set("workSessionActive", true);
			sdk.context.set("paneTargetActive", true);
		},
	});
	const notebookMain: PluginEntry = definePlugin({
		activate(sdk) {
			notebooks = sdk.domainObjects.provide(Notebooks, {
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
	const core: PluginRegistration = { manifest: coreManifest, definitions: CORE_DEFINITIONS };
	const shell: PluginRegistration = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const chat: PluginRegistration = { manifest: chatManifest, definitions: CHAT_DEFINITIONS };
	const workSessions: PluginRegistration = {
		manifest: workSessionsManifest,
		definitions: WORK_SESSIONS_DEFINITIONS,
	};
	const { main, renderer } = await createTestKernelPair({
		main: [
			{ ...core, entry: coreMain },
			shell,
			chat,
			sessions.registration,
			{
				manifest,
				definitions: NOTEBOOK_DEFINITIONS,
				...(options.withoutMain ? {} : { entry: notebookMain }),
			},
		],
		renderer: [
			core,
			{ ...shell, entry: shellWeb },
			chat,
			{ ...workSessions, entry: workSessionsWeb },
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
					workSessionId: SESSION_ID,
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
		openedPanes,
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
			(paneKind().implementation as PaneImplementation).canClose!({
				workSessionId: SESSION_ID,
				pane,
			}),
		setMode: (mode: "light" | "dark") =>
			act(async () => {
				theme.setState({ ...theme.state, mode });
				await main.flush();
			}),
		setAccount: (next: AccountState) =>
			act(async () => {
				account?.setState(next);
				setSignedIn(next.signedIn === true);
				await main.flush();
			}),
		renderPane: (props: Partial<PaneProps> = {}) => {
			const view = render(wrap(paneElement(props)));
			return {
				...view,
				rerenderPane: (next: Partial<PaneProps>) => view.rerender(wrap(paneElement(next))),
			};
		},
		render: (ui: ReactNode) => render(wrap(ui)),
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
