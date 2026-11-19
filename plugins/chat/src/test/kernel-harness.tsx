// Renders a piece of kilo.chat's UI in a kernel pair, without the shell's
// window around it: kilo.core, kilo.work-sessions and kilo.shell stand-ins in
// main (their real manifests and contracts) and kilo.chat's own entries.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { page } from "vitest/browser";

import {
	definePlugin,
	KernelOs,
	type DomainObjectProvider,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
} from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { Navigation, Notifications, SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { CHAT_DEFINITIONS } from "../contracts";
import { fakeCore, type FakeCoreOptions } from "./fake-core";
import { fakeWorkSessionsMain, type FakeWorkSessionsMainOptions } from "./fake-work-sessions";

export { SIGNED_IN, SIGNED_OUT } from "./fake-core";

/** An entry that does nothing: main only takes window calls from plugins that run there. */
export const EMPTY_ENTRY: PluginEntry = definePlugin({ activate: () => {} });

/**
 * kilo.shell's navigation and notifications in main, recording settings
 * opened, dialogs opened and toasts shown.
 */
export function fakeShellMain() {
	const calls = {
		openSettings: vi.fn<(section: string | undefined) => void>(),
		openDialog: vi.fn<(dialog: string, input: unknown) => void>(),
		toast:
			vi.fn<(toast: { level?: string; title: string; description?: string | undefined }) => void>(),
	};
	let navigation: DomainObjectProvider<typeof Navigation> | undefined;
	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			navigation = sdk.domainObjects.provide(Navigation, {
				initialState: { windows: {} },
				methods: {
					navigate: () => undefined,
					openSettings: ({ section }) => calls.openSettings(section),
					goHome: () => undefined,
					openDialog: ({ dialog, input }) => calls.openDialog(dialog, input),
					openTakeover: () => undefined,
					closeTakeover: () => undefined,
					reportLocation: () => undefined,
				},
			});
			sdk.domainObjects.provide(Notifications, {
				initialState: { notices: {} },
				methods: {
					toast: (toast) => calls.toast(toast),
					post: ({ id }) => id ?? "notice",
					dismiss: () => undefined,
				},
			});
		},
	});
	return {
		manifest: shellManifest,
		definitions: SHELL_DEFINITIONS,
		entry,
		calls,
		navigation: () => navigation,
	};
}

export interface RenderInKernelOptions {
	/** kilo.core's stand-in. */
	readonly core?: FakeCoreOptions;
	/** kilo.work-sessions' stand-in. */
	readonly workSessions?: FakeWorkSessionsMainOptions;
	/** kilo.chat's main entry (e.g. `createChatMainEntry(…)` or one area); none by default. */
	readonly chatMain?: PluginEntry;
	/** kilo.chat's window entry (one area); an empty one by default, as `ui` renders as kilo.chat. */
	readonly chatWeb?: PluginEntry;
	/** More main-side plugins. */
	readonly plugins?: readonly PluginRegistration[];
	/** More window-side plugins, e.g. ones contributing transcript renderers. */
	readonly rendererPlugins?: readonly PluginRegistration[];
}

/**
 * Renders `ui` in a kernel pair with kilo.core (signed in, `TEST_MODELS`,
 * chats over a FakeKiloServer), kilo.work-sessions (a workspace, one work
 * session, `authorize` allowing everything) and kilo.shell's navigation and
 * notifications in main, and kilo.chat's entries. `ui` renders as kilo.chat's
 * window half, as it does inside its contributions.
 */
export async function renderInKernel(ui: ReactNode, options: RenderInKernelOptions = {}) {
	cleanup();
	const opened: string[] = [];
	const workSessions = fakeWorkSessionsMain(options.workSessions);
	const core = fakeCore({ ...options.core, onChatCreated: workSessions.attachChat });
	const shell = fakeShellMain();
	const storage = createMemoryStorage("/data/kilo.chat");
	const host = await createTestKernelPair({
		host: createTestHost(),
		main: [
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS, entry: { activate: core.activate } },
			{ manifest: shell.manifest, definitions: shell.definitions, entry: shell.entry },
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				entry: workSessions.entry,
			},
			{ manifest, definitions: CHAT_DEFINITIONS, entry: options.chatMain ?? EMPTY_ENTRY },
			...(options.plugins ?? []),
		],
		renderer: [
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
			{ manifest: shell.manifest, definitions: shell.definitions },
			{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
			{ manifest, definitions: CHAT_DEFINITIONS, entry: options.chatWeb ?? EMPTY_ENTRY },
			...(options.rendererPlugins ?? []),
		],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? { storage }
				: { storage: createMemoryStorage(`/data/${pluginId}`) },
	});
	host.main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: ({ url }: { url: string }) => {
				opened.push(url);
				return true;
			},
			showItemInFolder: () => undefined,
			showLogs: () => ({ revealed: false }),
			logFilePath: () => "/logs/main.log",
		} as never,
	});
	await host.main.flush();
	const view = render(
		<KernelProvider kernel={host.renderer} as={manifest.id}>
			{ui}
		</KernelProvider>,
	);
	return {
		...host,
		view,
		core,
		workSessions,
		shell,
		/** kilo.chat's main-process storage. */
		storage,
		/** kilo.core's `signIn` calls. */
		signIn: core.calls.signIn,
		/** URLs opened in the browser. */
		opened,
		screen: page.elementLocator(view.baseElement),
	};
}
