// Test host for the terminal pane: main and a window linked in memory, with
// stand-ins (their real manifests and contracts) for kilo.work-sessions'
// panes and window (with `workSessionActive` / `paneTargetActive`),
// kilo.shell's theme, and kilo.terminal's `terminals` and shell port in main;
// kilo.core is present for its manifest. The pane renders as
// kilo.work-sessions' canvas renders it.
import { cleanup, render } from "@testing-library/react";
import { vi } from "vitest";

import {
	definePlugin,
	type DomainObjectProvider,
	type DomainObjectState,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS, Theme } from "@kilo-desktop/plugin-shell/contracts";
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

import manifest from "../../plugin.json";
import { TERMINAL_DEFINITIONS, TERMINAL_PROTOCOL_VERSION, Terminals } from "../contracts";
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
	const openPane = vi.fn((_input: unknown) => undefined);
	const windowOpenPane = vi.fn((_input: { kind: string }) => undefined);
	let theme!: DomainObjectProvider<typeof Theme>;

	const terminalMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(Terminals, {
				initialState: {},
				methods: { list: () => [], read: () => null, close: () => undefined },
			});
			sdk.ports.handle("session", (_port, args) => opened(args));
		},
	});
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
		setTheme: (next: ThemeState) => theme.setState(next),
		rerender: (next: Partial<PaneProps>) => view.rerender(element(next)),
		unmount: view.unmount,
		sdk: renderer.sdkFor("kilo.terminal"),
	};
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
