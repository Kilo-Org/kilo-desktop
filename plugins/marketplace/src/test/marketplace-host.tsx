// Test host for kilo.marketplace's window: main and a window linked in memory,
// with the `marketplace` domain object answered by the test's handlers, and
// stand-ins under their real manifests and definitions for kilo.shell (its
// points), kilo.work-sessions (its workspaces, the active one), kilo.chat (the
// window's composer, when `startNewChat` is given), a telemetry sink with
// consent, and the kernel's os and clipboard.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import {
	definePlugin,
	KernelClipboard,
	KernelDataCollection,
	KernelError,
	KernelOs,
	KernelTelemetrySink,
	type DomainObjectMethods,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS, Composer } from "@kilo-desktop/plugin-chat/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	WORK_SESSIONS_DEFINITIONS,
	Workspaces,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { Marketplace, MARKETPLACE_DEFINITIONS } from "../contracts/index";

export type MarketplaceHandlers = DomainObjectMethods<typeof Marketplace>;

/** A telemetry event as a sink received it: its declared name and data. */
export interface TrackedEvent {
	readonly event: string;
	readonly data: Readonly<Record<string, unknown>>;
}

export interface MarketplaceHostOptions {
	readonly handlers: MarketplaceHandlers;
	/** kilo.work-sessions' active workspace (none by default). */
	readonly activeWorkspaceId?: string;
	/** kilo.chat's composer `startChat`; leave undefined for a window without kilo.chat. */
	readonly startNewChat?: (input: { text: string }) => Promise<void>;
	readonly webEntry?: PluginEntry;
}

function asKernelError(error: unknown): KernelError {
	if (error instanceof KernelError) return error;
	return new KernelError("BUSINESS", error instanceof Error ? error.message : String(error));
}

const unused = () => {
	throw new KernelError("UNAVAILABLE", "Not in tests.");
};

const workSessionsMain = (activeId: string | null): PluginRegistration => ({
	manifest: workSessionsManifest,
	definitions: WORK_SESSIONS_DEFINITIONS,
	entry: definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(Workspaces, {
				initialState: { workspaces: [], activeId, unavailableFolderIds: [] },
				methods: new Proxy({}, { get: () => unused }) as never,
			});
		},
	}),
});

const chatWeb = (startNewChat: NonNullable<MarketplaceHostOptions["startNewChat"]>) =>
	definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(Composer, {
				initialState: { focusedWorkSessionId: null },
				methods: {
					focus: unused,
					insert: unused,
					startChat: async (input) => {
						await startNewChat({ text: input.text });
						return { workSessionId: "wses_1" };
					},
					prefillNewSession: unused,
				},
			});
		},
	});

/**
 * kilo.marketplace's window on a real kernel pair: the domain object from
 * `handlers`, kilo.work-sessions' active workspace, a telemetry sink,
 * kilo.chat's composer (when `startNewChat` is given), and the kernel's os
 * and clipboard.
 */
export async function bootMarketplaceHost(options: MarketplaceHostOptions) {
	cleanup();
	const tracked: TrackedEvent[] = [];
	const openExternal = vi.fn((_url: string) => undefined);
	const copyText = vi.fn((_text: string) => undefined);

	const marketplaceMain = definePlugin({
		activate(sdk) {
			const methods = Object.fromEntries(
				Object.entries(options.handlers).map(([name, handler]) => [
					name,
					async (input: never) => {
						try {
							return await (handler as (input: never) => unknown)(input);
						} catch (error) {
							throw asKernelError(error);
						}
					},
				]),
			) as unknown as MarketplaceHandlers;
			sdk.domainObjects.provide(Marketplace, { initialState: {}, methods });
		},
	});
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

	const shell = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const chat: PluginRegistration[] = options.startNewChat
		? [
				{
					manifest: chatManifest,
					definitions: CHAT_DEFINITIONS,
					entry: chatWeb(options.startNewChat),
				},
			]
		: [];
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			workSessionsMain(options.activeWorkspaceId ?? null),
			...(options.startNewChat ? [{ manifest: chatManifest, definitions: CHAT_DEFINITIONS }] : []),
			telemetrySink,
			{ manifest, definitions: MARKETPLACE_DEFINITIONS, entry: marketplaceMain },
		],
		renderer: [
			shell,
			{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
			...chat,
			{
				manifest,
				definitions: MARKETPLACE_DEFINITIONS,
				// Always a window entry: main only takes window calls from plugins that run there.
				entry: options.webEntry ?? definePlugin({ activate: () => {} }),
			},
		],
	});
	main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: ({ url }) => {
				openExternal(url);
				return true;
			},
			showItemInFolder: () => undefined,
			showLogs: () => ({ revealed: true }),
			logFilePath: () => "/logs/main.log",
		},
	});
	main.kernelSdk.domainObjects.provide(KernelClipboard, {
		initialState: {},
		methods: { writeText: ({ text }) => copyText(text) },
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
				<TooltipProvider>{element}</TooltipProvider>
			</QueryClientProvider>
		</KernelProvider>
	);
	return {
		main,
		renderer,
		queryClient,
		tracked,
		openExternal,
		copyText,
		render: (element: ReactNode) => render(wrap(element)),
	};
}
