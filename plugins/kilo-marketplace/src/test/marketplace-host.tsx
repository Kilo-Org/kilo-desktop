import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import {
	definePlugin,
	KernelClipboard,
	KernelError,
	KernelOs,
	type DomainMethods,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DOMAINS, SHELL_EXTENSION_POINTS } from "@kilo-desktop/plugin-shell/contracts";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { Telemetry, TELEMETRY_DEFINITIONS } from "@kilo-desktop/plugin-telemetry/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { Marketplace, MARKETPLACE_DEFINITIONS } from "../contracts/index.js";

export type MarketplaceHandlers = DomainMethods<typeof Marketplace>;

export interface MarketplaceHostOptions {
	readonly handlers: MarketplaceHandlers;
	/** kilo.workspaces' active workspace (none by default). */
	readonly activeWorkspaceId?: string;
	/** kilo.chat's composer `startNewChat`; leave undefined for a window without kilo.chat. */
	readonly startNewChat?: (input: { text: string }) => Promise<void>;
	readonly webEntry?: PluginEntry;
}

function asKernelError(error: unknown): KernelError {
	if (error instanceof KernelError) return error;
	return new KernelError("BUSINESS", error instanceof Error ? error.message : String(error));
}

const workspacesPlugin = (activeId: string | null) =>
	testPlugin("kilo.workspaces", {
		manifest: { domains: [{ id: "workspace", home: "main" }] },
		definitions: { domains: [Workspaces] },
		entry: definePlugin({
			activate(sdk) {
				const none = () => {
					throw new KernelError("UNAVAILABLE", "Not in tests.");
				};
				sdk.domains.provide(Workspaces, {
					initialState: { workspaces: [], activeId, unavailableFolderIds: [] },
					methods: new Proxy({}, { get: () => none }) as never,
				});
			},
		}),
	});

const chatPlugin = (startNewChat: NonNullable<MarketplaceHostOptions["startNewChat"]>) =>
	testPlugin("kilo.chat", {
		manifest: { domains: [{ id: "composer", home: "renderer" }] },
		definitions: { domains: [Composer] },
		entry: definePlugin({
			activate(sdk) {
				sdk.domains.provide(Composer, {
					initialState: { focusedSessionId: null },
					methods: {
						focus: () => undefined,
						insert: () => undefined,
						startNewChat: async (input) => {
							await startNewChat({ text: input.text });
							return { sessionId: "ses_1" };
						},
					},
				});
			},
		}),
	});

/**
 * kilo.marketplace's window on a real kernel pair: the domain object from
 * `handlers`, kilo.workspaces' active workspace, telemetry, kilo.chat's
 * composer (when `startNewChat` is given), and the kernel's shell and
 * clipboard.
 */
export async function bootMarketplaceHost(options: MarketplaceHostOptions) {
	cleanup();
	const tracked: { event: string; data: Record<string, unknown> }[] = [];
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
			sdk.domains.provide(Marketplace, { initialState: {}, methods });
		},
	});
	const telemetryMain = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Telemetry, {
				initialState: {},
				methods: {
					track: async (input) => {
						tracked.push(input);
					},
				},
			});
		},
	});

	const shell = {
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	};
	const chat: PluginRegistration[] = options.startNewChat ? [chatPlugin(options.startNewChat)] : [];
	const workspaces = workspacesPlugin(options.activeWorkspaceId ?? null);
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS, entry: telemetryMain },
			workspaces,
			{ manifest, definitions: MARKETPLACE_DEFINITIONS, entry: marketplaceMain },
		],
		renderer: [
			shell,
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS },
			{ manifest: workspaces.manifest, definitions: { domains: [Workspaces] } },
			...chat,
			{
				manifest,
				definitions: MARKETPLACE_DEFINITIONS,
				// Always a window entry: main only takes window calls from plugins that run there.
				entry: options.webEntry ?? definePlugin({ activate: () => {} }),
			},
		],
	});
	main.kernelSdk.domains.provide(KernelOs, {
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
	main.kernelSdk.domains.provide(KernelClipboard, {
		initialState: {},
		methods: { writeText: ({ text }) => copyText(text) },
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
