// Test host for the terminal pane: main and a window linked in memory, with
// stand-ins for kilo.sessions, kilo.workbench's navigator and kilo.shell's
// theme, and the pane rendered as kilo.workbench's canvas renders it.
import { cleanup, render } from "@testing-library/react";
import { vi } from "vitest";

import {
	definePlugin,
	type DomainProvider,
	type DomainState,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	SESSIONS_DEFINITIONS,
	type Pane,
	type PaneImplementation,
	type PaneProps,
} from "@kilo-desktop/plugin-sessions/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DOMAINS, SHELL_EXTENSION_POINTS, Theme } from "@kilo-desktop/plugin-shell/contracts";
import workbenchManifest from "@kilo-desktop/plugin-workbench/plugin.json";
import { Workbench, WORKBENCH_DEFINITIONS } from "@kilo-desktop/plugin-workbench/contracts";

import manifest from "../../plugin.json";
import { TERMINAL_DEFINITIONS, TERMINAL_PROTOCOL_VERSION, Terminals } from "../contracts";
import { terminalWebEntry } from "../web";

export type ThemeState = DomainState<typeof Theme>;

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
	readonly activeSessionId?: string | null;
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
	const workbenchOpenPane = vi.fn((_input: { kind: string }) => undefined);
	let theme!: DomainProvider<typeof Theme>;

	const terminalMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Terminals, {
				initialState: {},
				methods: { list: () => [], read: () => null, close: () => undefined },
			});
			sdk.ports.handle("session", (_port, args) => opened(args));
		},
	});
	const sessionsMain: PluginEntry = definePlugin({
		activate(sdk) {
			const panes: DomainProvider<typeof Panes> = sdk.domains.provide(Panes, {
				initialState: { bySession: {} },
				methods: {
					open: (input) => {
						openPane(input);
						const pane = terminalPane({ id: "pane_new" });
						panes.setState({
							bySession: {
								[input.sessionId]: { ...EMPTY_WORK_SESSION_PANES, panes: [pane] },
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
					importLegacy: () => undefined,
				},
			});
		},
	});
	const shellWeb: PluginEntry = definePlugin({
		activate(sdk) {
			if (!options.withoutTheme) {
				theme = sdk.domains.provide(Theme, { initialState: DARK_THEME, methods: {} });
			}
		},
	});
	const workbenchWeb: PluginEntry = definePlugin({
		activate(sdk) {
			const activeSessionId =
				options.activeSessionId === undefined ? "wses_1" : options.activeSessionId;
			sdk.domains.provide(Workbench, {
				initialState: { focus: null, activeSessionId, view: null, detachedViews: [] },
				methods: {
					setFocus: () => undefined,
					openSession: () => undefined,
					closeSession: () => undefined,
					showView: () => undefined,
					openPane: (input) => workbenchOpenPane(input),
				},
			});
			sdk.context.set("sessionActive", true);
		},
	});

	const shell = {
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	};
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, entry: sessionsMain },
			{ manifest: workbenchManifest, definitions: WORKBENCH_DEFINITIONS },
			{
				manifest,
				definitions: TERMINAL_DEFINITIONS,
				...(options.withoutMain ? {} : { entry: terminalMain }),
			},
		],
		renderer: [
			{ ...shell, entry: shellWeb },
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS },
			{ manifest: workbenchManifest, definitions: WORKBENCH_DEFINITIONS, entry: workbenchWeb },
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
					sessionId: "wses_1",
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
		workbenchOpenPane,
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
