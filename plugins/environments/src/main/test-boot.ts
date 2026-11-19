// Boots kilo.environments' main entry on a real main kernel (and a window),
// with stand-ins under the real manifests: kilo.core (its points, and a flag
// source the test can change), kilo.shell (its points, and a `navigation`
// recording the settings sections it is asked to open), kilo.chat and
// kilo.local-inference (their points). The bridge is a fake conda runner
// (`FakeBridge`). Any stand-in can be left out to check kilo.environments
// works without it.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import {
	definePlugin,
	KernelDialogs,
	KernelFlagSource,
	type FlagValue,
	type KernelLogger,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
} from "@kilo-desktop/kernel/testing";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	ChatConfigPoint,
	CORE_DEFINITIONS,
	Tool,
	type ChatConfig,
	type ToolCallContext,
} from "@kilo-desktop/plugin-core/contracts";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import {
	LlamaRuntime,
	LOCAL_INFERENCE_DEFINITIONS,
} from "@kilo-desktop/plugin-local-inference/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { Navigation, SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";

import manifest from "../../plugin.json";
import {
	Conda,
	CONDA_CHAT_CONFIG,
	CONDA_LLAMA_RUNTIME,
	CondaRuntime,
	ENVIRONMENTS_DEFINITIONS,
	ENVIRONMENTS_FLAG,
	ENVIRONMENTS_PLUGIN_ID,
} from "../contracts/index";
import { createEnvironmentsMainEntry, type EnvironmentsMainOptions } from "./entry";
import type { CondaBackend } from "./providers/conda/CondaBackend";
import type { BridgeLaunchInfo } from "./providers/conda/resolveBridgePath";
import type { CondaBridge, WarmableCondaBackend } from "./providers/conda/SharedCondaBridge";

export const LAUNCH: BridgeLaunchInfo = {
	command: ["/bridge/python"],
	payloadRoot: "/bridge",
	version: "1",
};

/** What the fake bridge answers per backend method: a value, or a function of the call's arguments. */
export type BridgeAnswers = Partial<Record<keyof CondaBackend, unknown>>;

/** A conda runner standing in for the bridge process: records calls, answers from `answers`. */
export class FakeBridge implements CondaBridge {
	readonly calls: { method: string; args: unknown[] }[] = [];
	starts = 0;
	releases = 0;
	disposed = false;
	readonly #backend: WarmableCondaBackend;

	constructor(
		readonly environment: Readonly<Record<string, string>> | undefined,
		answers: BridgeAnswers,
	) {
		this.#backend = new Proxy({} as WarmableCondaBackend, {
			get:
				(_target, method: string) =>
				(...args: unknown[]) => {
					if (method === "warmUp") {
						this.starts++;
						return Promise.resolve();
					}
					this.calls.push({ method, args });
					const answer = answers[method as keyof CondaBackend];
					return typeof answer === "function"
						? Promise.resolve().then(() => (answer as (...input: unknown[]) => unknown)(...args))
						: Promise.resolve(answer);
				},
		});
	}

	acquire() {
		return this.#backend;
	}

	release() {
		this.releases++;
	}

	dispose() {
		this.disposed = true;
	}
}

const kernels: { stop(): Promise<void> }[] = [];
const directories: string[] = [];

/** Stops every kernel and removes every folder made since the last call (an `afterEach`). */
export async function stopEnvironmentsMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/** kilo.core with its points and a flag source whose values the test sets. */
function coreStandIn(initial: Record<string, FlagValue>) {
	let values = initial;
	const listeners = new Set<() => void>();
	const registration: PluginRegistration = {
		manifest: coreManifest,
		definitions: CORE_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(KernelFlagSource, "launchdarkly", {
					values: () => values,
					subscribe: (listener) => {
						listeners.add(listener);
						return () => listeners.delete(listener);
					},
					identify: () => undefined,
				});
			},
		}),
	};
	return {
		registration,
		set(next: Record<string, FlagValue>) {
			values = next;
			for (const listener of listeners) listener();
		},
	};
}

/** kilo.shell with only its `navigation`, recording the settings sections it is asked to open. */
function shellStandIn(openSettings: (section: string | undefined) => void): PluginRegistration {
	const unused = () => undefined;
	return {
		manifest: shellManifest,
		definitions: SHELL_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(Navigation, {
					initialState: { windows: {} },
					methods: {
						navigate: unused,
						openSettings: ({ section }) => openSettings(section),
						goHome: unused,
						openDialog: unused,
						openTakeover: unused,
						closeTakeover: unused,
						reportLocation: unused,
					},
				});
			},
		}),
	};
}

export interface BootOptions {
	/** The `environments-feature` flag (default on). */
	readonly flag?: boolean;
	/** What `resolveBridge` finds; null when the payload is missing. */
	readonly bridge?: BridgeLaunchInfo | null;
	readonly answers?: BridgeAnswers;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
	readonly pickedFile?: string | null;
	readonly sentryDsn?: string;
	readonly llama?: EnvironmentsMainOptions["llama"];
	readonly withoutCore?: boolean;
	readonly withoutShell?: boolean;
	readonly withoutChat?: boolean;
	readonly withoutLocalInference?: boolean;
	readonly logger?: KernelLogger;
}

/** kilo.environments' main entry with its stand-ins, and a window. */
export async function bootEnvironmentsMain(options: BootOptions = {}) {
	const storageDir = await mkdtemp(path.join(tmpdir(), "environments-entry-"));
	directories.push(storageDir);
	const bridges: FakeBridge[] = [];
	let resolves = 0;
	const flagValues = { [ENVIRONMENTS_FLAG]: options.flag ?? true };
	const core = coreStandIn(flagValues);
	const openSettings = vi.fn<(section: string | undefined) => void>();
	const stub = (registration: PluginRegistration): PluginRegistration => ({
		...registration,
		entry: definePlugin({ activate() {} }),
	});
	const shell: PluginRegistration = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const chat: PluginRegistration = { manifest: chatManifest, definitions: CHAT_DEFINITIONS };
	const localInference: PluginRegistration = {
		manifest: localInferenceManifest,
		definitions: LOCAL_INFERENCE_DEFINITIONS,
	};
	const coreRegistration: PluginRegistration = {
		manifest: coreManifest,
		definitions: CORE_DEFINITIONS,
	};
	const { main } = await createTestKernelPair({
		main: [
			...(options.withoutCore ? [] : [core.registration]),
			...(options.withoutShell ? [] : [shellStandIn(openSettings)]),
			...(options.withoutChat ? [] : [stub(chat)]),
			...(options.withoutLocalInference ? [] : [stub(localInference)]),
			{
				manifest,
				definitions: ENVIRONMENTS_DEFINITIONS,
				entry: createEnvironmentsMainEntry({
					resolveBridge: () => {
						resolves++;
						return options.bridge === undefined ? LAUNCH : options.bridge;
					},
					createBridge: (_sdk, bridgeOptions) => {
						const bridge = new FakeBridge(bridgeOptions.environment, options.answers ?? {});
						bridges.push(bridge);
						return bridge;
					},
					platform: options.platform ?? "darwin",
					arch: options.arch ?? "arm64",
					condaFilesRoot: path.join(storageDir, "conda"),
					...(options.sentryDsn === undefined ? {} : { sentryDsn: options.sentryDsn }),
					...(options.llama ? { llama: options.llama } : {}),
				}),
			},
		],
		renderer: [
			...(options.withoutCore ? [] : [coreRegistration]),
			...(options.withoutShell ? [] : [shell]),
			...(options.withoutChat ? [] : [chat]),
			...(options.withoutLocalInference ? [] : [localInference]),
			{
				manifest,
				definitions: ENVIRONMENTS_DEFINITIONS,
				entry: definePlugin({ activate() {} }),
			},
		],
		// Without kilo.core there is no flag source; the host's overrides set the flag instead.
		host: createTestHost(options.withoutCore ? { flagOverrides: flagValues } : {}),
		mainHostServices: (pluginId) => ({
			storage: createMemoryStorage(pluginId === manifest.id ? storageDir : `/memory/${pluginId}`),
		}),
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(main);
	main.kernelSdk.domainObjects.provide(KernelDialogs, {
		initialState: {},
		methods: {
			open: () => ({ paths: options.pickedFile ? [options.pickedFile] : [] }),
			save: () => ({ path: null }),
			message: () => ({ response: 0, checkboxChecked: false }),
		},
	});
	await main.flush();

	const own = <T extends { key: string }>(list: readonly T[], id: string) =>
		list.find((candidate) => candidate.key === `${ENVIRONMENTS_PLUGIN_ID}/${id}`);
	const conda = () => main.kernelSdk.domainObjects.get(Conda)!;
	const condaRuntime = () => main.kernelSdk.domainObjects.get(CondaRuntime)!;
	const tool = (id: string) => own(main.kernelSdk.extensions.list(Tool), id);
	const callTool = (id: string, input: unknown = {}) => {
		const { implementation } = tool(id)!;
		const context: ToolCallContext = {
			chatId: "ses_1",
			workSessionId: "wses_1",
			workspaceId: "ws_1",
			callId: "call_1",
			external: false,
			signal: new AbortController().signal,
		};
		return Promise.resolve().then(() =>
			implementation!.run(implementation!.input.parse(input), context),
		);
	};
	const chatConfigContribution = () =>
		own(main.kernelSdk.extensions.list(ChatConfigPoint), CONDA_CHAT_CONFIG);
	const chatConfig = async (): Promise<ChatConfig> =>
		chatConfigContribution()!.implementation!.configure({
			chatId: "ses_1",
			directory: "/work",
			workSessionId: "wses_1",
			workspaceId: "ws_1",
		});
	const llamaRuntime = () => own(main.kernelSdk.extensions.list(LlamaRuntime), CONDA_LLAMA_RUNTIME);
	return {
		main,
		storageDir,
		bridges,
		openSettings,
		conda,
		condaRuntime,
		tool,
		callTool,
		chatConfigContribution,
		chatConfig,
		llamaRuntime,
		setFlag: (on: boolean) => core.set({ [ENVIRONMENTS_FLAG]: on }),
		resolves: () => resolves,
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
