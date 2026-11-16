// Test host for kilo.browser's web entry: main and a window linked in memory,
// with kilo.browser's real main entry on a fake embedded browser, stand-ins
// (their real manifests and definitions) for kilo.work-sessions (panes and
// openers in main, the window's `window` object), a telemetry sink with
// consent and the kernel's os, and kilo.core's and kilo.chat's points. Panes
// render as kilo.work-sessions' canvas renders them.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import {
	definePlugin,
	KernelDataCollection,
	KernelError,
	KernelOs,
	KernelTelemetrySink,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import {
	CHAT_DEFINITIONS,
	MarkdownExtension,
	type MarkdownExtensionImplementation,
} from "@kilo-desktop/plugin-chat/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	PaneKind,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessionsWindow,
	type Pane,
	type PaneImplementation,
	type PaneProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { BROWSER_DEFINITIONS, BROWSER_PANE_KIND } from "../contracts/index.js";
import { createBrowserMainEntry } from "../main/entry.js";
import { browserWebEntry } from "../web/index.js";
import { createFakeBrowserHost } from "./fake-browser-host.js";
import { browserPane, coreRegistration, createSessionsHost, SESSION_ID } from "./sessions-host.js";

/** A telemetry event as a sink received it: its declared name and data. */
export interface TrackedEvent {
	readonly event: string;
	readonly data: Readonly<Record<string, unknown>>;
}

export interface BrowserHostOptions {
	readonly panes?: readonly Pane[];
	/** Leaves kilo.browser's main entry out, as in the browser. */
	readonly withoutMain?: boolean;
	/** kilo.browser's main runs without the host's embedded browser. */
	readonly withoutHost?: boolean;
	/** Leaves kilo.work-sessions' panes out of main. */
	readonly withoutSessions?: boolean;
	readonly activeSessionId?: string | null;
	/** What kilo.work-sessions' `WorkSessionsWindow.openPane` does. */
	readonly openPane?: (input: { kind: string }) => void;
}

export async function bootBrowserHost(options: BrowserHostOptions = {}) {
	cleanup();
	for (const host of document.querySelectorAll("[data-browser-webview-host]")) {
		Element.prototype.remove.call(host);
	}
	const fake = createFakeBrowserHost();
	const sessions = createSessionsHost({ panes: options.panes ?? [browserPane("pane_a")] });
	const tracked: TrackedEvent[] = [];
	const opened: string[] = [];
	const unused = (name: string) => () => {
		throw new KernelError("NOT_FOUND", `${name} is not faked here.`);
	};

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
	const workSessionsWeb: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(WorkSessionsWindow, {
				initialState: {
					focus: null,
					activeWorkSessionId:
						options.activeSessionId === undefined ? SESSION_ID : options.activeSessionId,
					view: null,
					detachedViews: [],
				},
				methods: {
					setFocus: () => undefined,
					openWorkSession: () => undefined,
					closeWorkSession: () => undefined,
					showView: () => undefined,
					openPane: (input) => options.openPane?.(input),
				},
			});
			sdk.context.set("workSessionActive", options.activeSessionId !== null);
			sdk.context.set("paneTargetActive", options.activeSessionId !== null);
		},
	});
	const browserMain = createBrowserMainEntry({
		host: () => (options.withoutHost ? undefined : fake.host),
		windows: false,
	});
	const workSessionsMain: PluginRegistration = options.withoutSessions
		? { manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS }
		: sessions.registration;
	const { main, renderer } = await createTestKernelPair({
		main: [
			coreRegistration,
			workSessionsMain,
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{
				manifest,
				definitions: BROWSER_DEFINITIONS,
				...(options.withoutMain ? {} : { entry: browserMain }),
			},
			telemetrySink,
		],
		renderer: [
			coreRegistration,
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				entry: workSessionsWeb,
			},
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{ manifest, definitions: BROWSER_DEFINITIONS, entry: browserWebEntry },
		],
	});
	main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: ({ url }) => {
				opened.push(url);
				return true;
			},
			showItemInFolder: unused("showItemInFolder"),
			showLogs: unused("showLogs"),
			logFilePath: unused("logFilePath"),
		},
	});
	main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "test" },
		methods: { setChoice: () => {} },
	});
	await main.flush();

	const paneKind = () =>
		renderer.extensions.list(PaneKind).find((candidate) => candidate.key === BROWSER_PANE_KIND);
	const markdownExtension = (workSessionId: string) => {
		const contribution = renderer.extensions
			.list(MarkdownExtension)
			.find((candidate) => candidate.key === "kilo.browser/web-links");
		return (contribution!.implementation as MarkdownExtensionImplementation)({
			workSessionId,
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
					workSessionId: SESSION_ID,
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
