// Test host for the terminal pane and its settings page: main and a window
// linked in memory, with stand-ins (their real manifests and contracts) for
// kilo.work-sessions' panes and window (with `workSessionActive` /
// `paneTargetActive`), kilo.shell's theme, and kilo.terminal's `terminals`
// and shell port in main; kilo.core is present for its manifest. The pane
// renders as kilo.work-sessions' canvas renders it, the settings page as
// kilo.shell's Settings renders a section.
import { cleanup, render } from "@testing-library/react";
import { vi } from "vitest";

import {
	definePlugin,
	type DomainObjectProvider,
	type DomainObjectState,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	SettingsSection,
	SHELL_DEFINITIONS,
	Theme,
	type SettingsSectionImplementation,
} from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessionsWindow,
	type Pane,
	type PaneImplementation,
	type PaneProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { SettingsSectionProvider } from "@kilo-desktop/ui/components/settings-page-header";

import manifest from "../../plugin.json";
import {
	DEFAULT_TERMINAL_SETTINGS,
	TERMINAL_DEFINITIONS,
	TERMINAL_PROTOCOL_VERSION,
	Terminals,
	type TerminalProfile,
	type TerminalSettings,
} from "../contracts";
import { terminalWebEntry } from "../web";

export type ThemeState = DomainObjectState<typeof Theme>;

export const DARK_THEME: ThemeState = {
	mode: "dark",
	themeId: "kilo",
	accentId: "blue",
	terminal: null,
	shiki: "kilo-dark",
};

export const terminalPane = (overrides: Partial<Pane> = {}): Pane => ({
	id: "pane_1",
	kind: "kilo.terminal/terminal",
	title: "Terminal",
	metadata: {},
	ordinal: 1,
	...overrides,
});

export interface TerminalHostOptions {
	/** Leaves kilo.terminal's main entry out, as in the browser. */
	readonly withoutMain?: boolean;
	readonly activeWorkSessionId?: string | null;
	/** Leaves kilo.shell's theme out. */
	readonly withoutTheme?: boolean;
}

export async function renderTerminalHost(
	props: Partial<PaneProps> = {},
	options: TerminalHostOptions = {},
) {
	cleanup();
	const opened = vi.fn((_args: unknown) => undefined);
	const terminalMain: PluginEntry = definePlugin({
		activate(sdk) {
			provideTerminals(sdk);
			sdk.ports.handle("session", (_port, args) => opened(args));
		},
	});
	const { main, renderer, openPane, windowOpenPane, theme } = await bootTerminalPair(
		terminalMain,
		options,
	);

	const contribution = renderer.extensions
		.list(PaneKind)
		.find((candidate) => candidate.key === "kilo.terminal/terminal")!;
	const element = (next: Partial<PaneProps>) => (
		<KernelProvider kernel={renderer}>
			<RenderContribution
				contribution={contribution}
				props={{
					workSessionId: "wses_1",
					pane: terminalPane(),
					workspaceId: null,
					directory: null,
					visible: true,
					...next,
				}}
				select={(implementation: PaneImplementation) => implementation.component}
			/>
		</KernelProvider>
	);
	const view = render(element(props));
	return {
		main,
		renderer,
		opened,
		openPane,
		windowOpenPane,
		contribution,
		setTheme: (next: ThemeState) => theme()?.setState(next),
		rerender: (next: Partial<PaneProps>) => view.rerender(element(next)),
		unmount: view.unmount,
		sdk: renderer.sdkFor("kilo.terminal"),
	};
}

type SettingsPatch = Partial<TerminalSettings>;

export interface TerminalSettingsHostOptions {
	readonly profiles?: TerminalProfile[];
	readonly settings?: TerminalSettings;
	/** Leaves kilo.terminal's main entry out, as in the browser. */
	readonly withoutMain?: boolean;
	/** Replaces saving (to fail it); the stand-in otherwise merges the patch into its state. */
	readonly updateSettings?: (patch: SettingsPatch) => TerminalSettings;
}

/** Renders the Terminal settings page as Settings does, over a stand-in `terminals` in main. */
export async function renderTerminalSettings(options: TerminalSettingsHostOptions = {}) {
	cleanup();
	let terminals!: DomainObjectProvider<typeof Terminals>;
	const updateSettings = vi.fn((patch: SettingsPatch) => {
		if (options.updateSettings) return options.updateSettings(patch);
		const current = terminals.state.settings;
		const settings: TerminalSettings = {
			defaultProfileId:
				patch.defaultProfileId === undefined ? current.defaultProfileId : patch.defaultProfileId,
			customProfiles: patch.customProfiles ?? current.customProfiles,
		};
		terminals.setState({ ...terminals.state, settings });
		return settings;
	});
	const refreshProfiles = vi.fn(() => terminals.state.profiles);
	const terminalMain: PluginEntry = definePlugin({
		activate(sdk) {
			terminals = provideTerminals(sdk, {
				profiles: options.profiles ?? [],
				settings: options.settings ?? DEFAULT_TERMINAL_SETTINGS,
				updateSettings,
				refreshProfiles,
			});
		},
	});
	const { renderer } = await bootTerminalPair(terminalMain, options);
	const section = renderer.extensions
		.list(SettingsSection)
		.find((candidate) => candidate.key === "kilo.terminal/terminal")!;
	const Component = (section.implementation as SettingsSectionImplementation).component;
	const view = render(
		<KernelProvider kernel={renderer}>
			<SettingsSectionProvider
				value={{
					title: section.metadata.title,
					...(section.metadata.description ? { description: section.metadata.description } : {}),
				}}
			>
				<Component />
			</SettingsSectionProvider>
		</KernelProvider>,
	);
	return { ...view, renderer, updateSettings, refreshProfiles };
}

interface TerminalsStandIn {
	readonly profiles: TerminalProfile[];
	readonly settings: TerminalSettings;
	readonly updateSettings: (patch: SettingsPatch) => TerminalSettings;
	readonly refreshProfiles: () => TerminalProfile[];
}

function provideTerminals(sdk: PluginSdk, standIn?: TerminalsStandIn) {
	return sdk.domainObjects.provide(Terminals, {
		initialState: {
			profiles: standIn?.profiles ?? [],
			settings: standIn?.settings ?? DEFAULT_TERMINAL_SETTINGS,
		},
		methods: {
			list: () => [],
			read: () => null,
			close: () => undefined,
			updateSettings: (patch) =>
				standIn ? standIn.updateSettings(patch as SettingsPatch) : DEFAULT_TERMINAL_SETTINGS,
			refreshProfiles: () => standIn?.refreshProfiles() ?? [],
		},
	});
}

/** The kernel pair with every stand-in, and kilo.terminal's real web entry. */
async function bootTerminalPair(terminalMain: PluginEntry, options: TerminalHostOptions) {
	const openPane = vi.fn((_input: unknown) => undefined);
	const windowOpenPane = vi.fn((_input: { kind: string }) => undefined);
	let theme: DomainObjectProvider<typeof Theme> | undefined;

	const workSessionsMain: PluginEntry = definePlugin({
		activate(sdk) {
			const panes: DomainObjectProvider<typeof Panes> = sdk.domainObjects.provide(Panes, {
				initialState: { byWorkSession: {} },
				methods: {
					open: (input) => {
						openPane(input);
						const pane = terminalPane({ id: "pane_new" });
						panes.setState({
							byWorkSession: {
								[input.workSessionId]: { ...EMPTY_WORK_SESSION_PANES, panes: [pane] },
							},
						});
						return pane;
					},
					openObject: () => null,
					activate: () => undefined,
					update: () => terminalPane(),
					close: () => ({ closed: false }),
					setLayout: () => undefined,
					setArrangement: () => undefined,
				},
			});
		},
	});
	const shellWeb: PluginEntry = definePlugin({
		activate(sdk) {
			if (!options.withoutTheme) {
				theme = sdk.domainObjects.provide(Theme, { initialState: DARK_THEME, methods: {} });
			}
		},
	});
	const workSessionsWeb: PluginEntry = definePlugin({
		activate(sdk) {
			const activeWorkSessionId =
				options.activeWorkSessionId === undefined ? "wses_1" : options.activeWorkSessionId;
			sdk.domainObjects.provide(WorkSessionsWindow, {
				initialState: { focus: null, activeWorkSessionId, view: null, detachedViews: [] },
				methods: {
					setFocus: () => undefined,
					openWorkSession: () => undefined,
					closeWorkSession: () => undefined,
					showView: () => undefined,
					openPane: (input) => windowOpenPane(input),
				},
			});
			sdk.context.set("workSessionActive", true);
			sdk.context.set("paneTargetActive", true);
		},
	});

	const core = { manifest: coreManifest, definitions: CORE_DEFINITIONS };
	const shell = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const workSessions = { manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS };
	const { main, renderer } = await createTestKernelPair({
		main: [
			core,
			shell,
			{ ...workSessions, entry: workSessionsMain },
			{
				manifest,
				definitions: TERMINAL_DEFINITIONS,
				...(options.withoutMain ? {} : { entry: terminalMain }),
			},
		],
		renderer: [
			core,
			{ ...shell, entry: shellWeb },
			{ ...workSessions, entry: workSessionsWeb },
			{ manifest, definitions: TERMINAL_DEFINITIONS, entry: terminalWebEntry },
		],
	});
	return { main, renderer, openPane, windowOpenPane, theme: () => theme };
}

/**
 * Serves the frame from the test page's own origin, so its window stays
 * same-origin and its posts can be captured once it has loaded.
 */
export function stubTerminalOrigin(): string {
	vi.stubEnv("VITE_TERMINAL_ORIGIN", window.location.origin);
	return window.location.origin;
}

export function terminalFrame(): HTMLIFrameElement {
	const frame = document.querySelector<HTMLIFrameElement>('[data-qa-id="terminal-frame"]');
	if (!frame) throw new Error("Expected a terminal frame");
	return frame;
}

/** The terminal frame once loaded, its posts captured. */
export async function loadedFrame() {
	const frame = terminalFrame();
	await vi.waitFor(() => {
		const href = frame.contentWindow?.location.href ?? "";
		if (!href.includes("/index.html") || frame.contentDocument?.readyState !== "complete") {
			throw new Error("The terminal frame hasn't loaded yet.");
		}
	});
	const postMessage = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
	return { frame, postMessage };
}

/** The terminal frame, loaded and its posts captured, announcing that it is ready. */
export async function readyFrame(origin = window.location.origin) {
	const { frame, postMessage } = await loadedFrame();
	window.dispatchEvent(
		new MessageEvent("message", {
			origin,
			source: frame.contentWindow,
			data: { type: "terminal:ready", protocolVersion: TERMINAL_PROTOCOL_VERSION },
		}),
	);
	return { frame, postMessage };
}
