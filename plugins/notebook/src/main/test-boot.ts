// Boots kilo.notebook's main entry on a real main kernel (and a window), with
// stand-ins under the real manifests: kilo.core (its points, no server),
// kilo.work-sessions (work sessions and panes in memory, from
// src/test/sessions-host.ts), kilo.shell (its points) and a kilo.files-like
// opener; nteract's host service is src/test/fake-host-service.ts. Any
// stand-in can be left out to check kilo.notebook works without it.
import { rm } from "node:fs/promises";

import {
	definePlugin,
	KernelDataCollection,
	type EmbeddedHostRegistration,
	type FlagValue,
	type KernelLogger,
	type PluginAssets,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
} from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import { Panes, type Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { NOTEBOOK_DEFINITIONS, Notebooks } from "../contracts/index.js";
import { createFakeHostServices } from "../test/fake-host-service.js";
import { createSessionsHost, filesOpener, SESSION_ID } from "../test/sessions-host.js";
import { createNotebookMainEntry, type NotebookMainOptions } from "./entry.js";

export const NEW_ID = "11111111-2222-4333-8444-555555555555";
export const SOCKET_PATH = "/tmp/runtimed.sock";
export const RUNTIMED_NODE_ENTRY = "/app.asar.unpacked/node_modules/@runtimed/node/index.cjs";

export interface BootOptions {
	readonly useDefaultSocket?: boolean;
	readonly panes?: readonly Pane[];
	readonly entry?: Partial<NotebookMainOptions>;
	/** Leaves kilo.work-sessions (and the files opener) out. */
	readonly withoutWorkSessions?: boolean;
	readonly withoutCore?: boolean;
	readonly withoutShell?: boolean;
	readonly withoutEmbeddedHosts?: boolean;
	/** The files kilo.notebook ships; absent where the host has none. */
	readonly assets?: PluginAssets;
	/** Flag values, as the host's overrides. */
	readonly flags?: Readonly<Record<string, FlagValue>>;
	/** Data-collection consent (default: not allowed). */
	readonly allowed?: boolean;
	readonly logger?: KernelLogger;
}

const kernels: { stop(): Promise<void> }[] = [];
const directories: string[] = [];

/** Stops every kernel and removes every folder registered since the last call (an `afterEach`). */
export async function stopNotebookMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
}

/** Removes `directory` in the next {@link stopNotebookMains}. */
export function removeLater(directory: string): string {
	directories.push(directory);
	return directory;
}

/** kilo.notebook's main entry with its stand-ins, and a window. */
export async function bootNotebookMain(options: BootOptions = {}) {
	const services = createFakeHostServices();
	const sessions = createSessionsHost(options.panes ?? []);
	const storage = createMemoryStorage("/memory/kilo.notebook");
	const embedded: EmbeddedHostRegistration[] = [];
	const stub = (registration: PluginRegistration, withEntry: boolean): PluginRegistration =>
		withEntry ? { ...registration, entry: definePlugin({ activate() {} }) } : registration;
	const points = (withEntry: boolean): PluginRegistration[] => [
		...(options.withoutCore
			? []
			: [stub({ manifest: coreManifest, definitions: CORE_DEFINITIONS }, withEntry)]),
		...(options.withoutShell
			? []
			: [stub({ manifest: shellManifest, definitions: SHELL_DEFINITIONS }, withEntry)]),
	];
	const { main, renderer } = await createTestKernelPair({
		main: [
			...points(true),
			...(options.withoutWorkSessions ? [] : [sessions.registration, filesOpener]),
			{
				manifest,
				definitions: NOTEBOOK_DEFINITIONS,
				entry: createNotebookMainEntry({
					createHostService: services.create,
					...(options.useDefaultSocket ? {} : { socketPath: SOCKET_PATH }),
					warmStart: false,
					createId: () => NEW_ID,
					resolveRuntimedBinary: () => "/resources/runtimed/runtimed-nightly",
					resolveBundleRoot: () => "/resources/notebook",
					resolveRuntimedNodeEntry: () => RUNTIMED_NODE_ENTRY,
					...options.entry,
				}),
			},
		],
		renderer: [
			...points(false),
			{ manifest, definitions: NOTEBOOK_DEFINITIONS, entry: definePlugin({ activate() {} }) },
		],
		host: createTestHost(options.flags ? { flagOverrides: options.flags } : {}),
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? {
						storage,
						...(options.assets ? { assets: options.assets } : {}),
						...(options.withoutEmbeddedHosts
							? {}
							: {
									embeddedHosts: {
										register: (registration: EmbeddedHostRegistration) => {
											embedded.push(registration);
											return () => undefined;
										},
									},
								}),
					}
				: { storage: createMemoryStorage(`/memory/${pluginId}`) },
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(main);
	main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: {
			choice: true,
			allowed: options.allowed ?? false,
			installationId: "install",
			environment: "development",
		},
		methods: { setChoice: () => undefined },
	});
	await main.flush();
	const notebooks = main.kernelSdk.domainObjects.get(Notebooks)!;
	const panes = () => main.kernelSdk.domainObjects.get(Panes)!;
	const paneOf = (paneId: string) => sessions.panes().panes.find((pane) => pane.id === paneId);
	const tool = (id: string) =>
		main.kernelSdk.extensions
			.list(Tool)
			.find((contribution) => contribution.key === `kilo.notebook/${id}`)!;
	const callTool = (id: string, input: unknown = {}, workSessionId: string | null = SESSION_ID) => {
		const context: ToolCallContext = {
			chatId: workSessionId ? "chat" : null,
			workSessionId,
			workspaceId: null,
			callId: "call_1",
			external: false,
			signal: new AbortController().signal,
		};
		const { implementation } = tool(id);
		return Promise.resolve().then(() =>
			implementation!.run(implementation!.input.parse(input), context),
		);
	};
	return {
		main,
		renderer,
		services,
		sessions,
		storage,
		embedded,
		notebooks,
		panes,
		paneOf,
		tool,
		callTool,
	};
}

/** A logger recording warnings and errors. */
export function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}
