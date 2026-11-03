// Test host for kilo.browser's web entry: main and a window linked in memory,
// with kilo.browser's real main entry on a fake embedded browser, stand-ins
// for kilo.sessions (panes and openers), kilo.workbench's navigator,
// kilo.telemetry and the kernel's shell, and kilo.chat's and kilo.sessions'
// points. Panes render as kilo.workbench's canvas renders them.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import {
	definePlugin,
	KernelShell,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import {
	CHAT_DEFINITIONS,
	MarkdownExtension,
	type MarkdownExtensionImplementation,
} from "@kilo-desktop/plugin-chat/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	PaneKind,
	SESSIONS_DEFINITIONS,
	type Pane,
	type PaneImplementation,
	type PaneProps,
} from "@kilo-desktop/plugin-sessions/contracts";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import {
	Telemetry,
	TELEMETRY_DEFINITIONS,
	type TrackInput,
} from "@kilo-desktop/plugin-telemetry/contracts";
import workbenchManifest from "@kilo-desktop/plugin-workbench/plugin.json";
import {
	Navigator,
	PaneLauncher,
	WORKBENCH_DEFINITIONS,
} from "@kilo-desktop/plugin-workbench/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { BROWSER_DEFINITIONS, BROWSER_PANE_KIND } from "../contracts/index.js";
import { createBrowserMainEntry } from "../main/entry.js";
import { browserWebEntry } from "../web/index.js";
import { createFakeBrowserHost } from "./fake-browser-host.js";
import { browserPane, createSessionsHost, SESSION_ID } from "./sessions-host.js";

export interface BrowserHostOptions {
	readonly panes?: readonly Pane[];
	/** Leaves kilo.browser's main entry out, as in the browser. */
	readonly withoutMain?: boolean;
	/** kilo.browser's main runs without the host's embedded browser. */
	readonly withoutHost?: boolean;
	/** Leaves kilo.sessions out. */
	readonly withoutSessions?: boolean;
	readonly activeSessionId?: string | null;
	/** kilo.workbench's pane launcher; left out unless given. */
	readonly openOrShowPane?: (input: { kind: string }) => void;
}

export async function bootBrowserHost(options: BrowserHostOptions = {}) {
	cleanup();
	for (const host of document.querySelectorAll("[data-browser-webview-host]")) {
		Element.prototype.remove.call(host);
	}
	const fake = createFakeBrowserHost();
	const sessions = createSessionsHost(options.panes ?? [browserPane("pane_a")]);
	const tracked: TrackInput[] = [];
	const opened: string[] = [];

	const telemetryMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Telemetry, {
				initialState: {},
				methods: {
					track: (input) => {
						tracked.push(input);
					},
				},
			});
		},
	});
	const workbenchWeb: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Navigator, {
				initialState: {
					focus: null,
					activeSessionId:
						options.activeSessionId === undefined ? SESSION_ID : options.activeSessionId,
					view: null,
					detachedViews: [],
				},
				methods: {
					setFocus: () => undefined,
					open: () => undefined,
					close: () => undefined,
					showView: () => undefined,
				},
			});
			const openOrShowPane = options.openOrShowPane;
			if (openOrShowPane) {
				sdk.domains.provide(PaneLauncher, {
					initialState: {},
					methods: { openOrShow: (input) => openOrShowPane(input) },
				});
			}
			sdk.context.set("sessionActive", options.activeSessionId !== null);
		},
	});
	const browserMain = createBrowserMainEntry({
		host: () => (options.withoutHost ? undefined : fake.host),
		windows: false,
	});
	const sessionsMain: PluginRegistration[] = options.withoutSessions ? [] : [sessions.registration];
	const { main, renderer } = await createTestKernelPair({
		main: [
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS, entry: telemetryMain },
			...sessionsMain,
			{ manifest: workbenchManifest, definitions: WORKBENCH_DEFINITIONS },
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{
				manifest,
				definitions: BROWSER_DEFINITIONS,
				...(options.withoutMain ? {} : { entry: browserMain }),
			},
		],
		renderer: [
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS },
			...(options.withoutSessions
				? []
				: [{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS }]),
			{ manifest: workbenchManifest, definitions: WORKBENCH_DEFINITIONS, entry: workbenchWeb },
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{ manifest, definitions: BROWSER_DEFINITIONS, entry: browserWebEntry },
		],
	});
	main.kernelSdk.domains.provide(KernelShell, {
		initialState: {},
		methods: {
			openExternal: ({ url }: { url: string }) => {
				opened.push(url);
				return true;
			},
		} as never,
	});
	await main.flush();

	const paneKind = () =>
		renderer.extensions.list(PaneKind).find((candidate) => candidate.key === BROWSER_PANE_KIND);
	const markdownExtension = (sessionId: string) => {
		const contribution = renderer.extensions
			.list(MarkdownExtension)
			.find((candidate) => candidate.key === "kilo.browser/web-links");
		return (contribution!.implementation as MarkdownExtensionImplementation)({
			sessionId,
			workspaceFolders: [],
		});
	};
	const wrap = (ui: ReactNode) => (
		<KernelProvider kernel={renderer}>
			<TooltipProvider>{ui}</TooltipProvider>
		</KernelProvider>
	);
	const paneElement = (props: Partial<PaneProps>) => (
		<div
			data-qa-id="chat-pane-frame"
			style={{
				width: 640,
				height: 480,
				display: "flex",
				borderBottomLeftRadius: "12px",
				borderBottomRightRadius: "12px",
			}}
		>
			<RenderContribution
				contribution={paneKind()!}
				props={{
					sessionId: SESSION_ID,
					pane: sessions.panes().panes[0] ?? browserPane("pane_a"),
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
		fake,
		sessions,
		tracked,
		opened,
		paneKind,
		markdownExtension,
		sdk: renderer.sdkFor("kilo.browser"),
		render: (ui: ReactNode) => render(wrap(ui)),
		renderPane: (props: Partial<PaneProps> = {}) => {
			const view = render(wrap(paneElement(props)));
			return {
				...view,
				rerenderPane: (next: Partial<PaneProps>) => view.rerender(wrap(paneElement(next))),
			};
		},
	};
}

export type BrowserTestHost = Awaited<ReturnType<typeof bootBrowserHost>>;

/** The pane's `<webview>`, once the window created it. */
export function webview(): HTMLElement {
	const element = document.querySelector<HTMLElement>("webview");
	if (!element) throw new Error("Expected a browser webview");
	return element;
}

/** Gives the webview a guest (as Electron does once it attaches) and announces it. */
export function attachGuest(webContentsId: number, event = "did-attach") {
	const element = webview();
	const reload = vi.fn();
	Object.assign(element, { getWebContentsId: () => webContentsId, reload });
	element.dispatchEvent(new Event(event));
	return { element, reload };
}
