import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import {
	definePlugin,
	KernelDataCollection,
	KernelFlagSource,
	KernelServices,
	type DomainObjectProvider,
	type FlagValue,
	type PluginRegistration,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import {
	CORE_DEFINITIONS,
	EXTERNAL_AI_APPS_FLAG,
	KiloAccount,
	type AccountState,
} from "../../contracts";
import { activateAgent, type AgentOptions } from "../../main/agent";
import { FakeKiloChats } from "./fake-kilo-chats";
import { FakeServer } from "./fake-server";

/** Readiness spans server, stream and kernel turns, which take longer when every package's tests run at once. */
export const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 5_000 });

const cleanups: (() => Promise<unknown> | unknown)[] = [];

/** Stops every kernel and removes every folder the tests made; call from `afterEach`. */
export async function cleanUpAgents(): Promise<void> {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

/** Runs `cleanup` with the booted agents' cleanup (MCP clients, folders). */
export function onCleanUp(cleanup: () => Promise<unknown> | unknown): void {
	cleanups.push(cleanup);
}

export async function tempDir(prefix = "kilo-core-agent-"): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), prefix));
	cleanups.unshift(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
	return dir;
}

function accountState(signedIn: boolean): AccountState {
	return {
		connection: "connected",
		signedIn,
		profile: null,
		profileError: null,
		deviceSignIn: { status: "idle" },
		organizationError: null,
		refreshing: false,
		switchingOrganization: false,
	};
}

export interface BootOptions {
	readonly plugins?: readonly PluginRegistration[];
	readonly showWindow?: boolean;
	readonly termsAccepted?: boolean;
	readonly signedIn?: boolean;
	readonly externalApps?: boolean;
	readonly chats?: FakeKiloChats;
	/** kilo.core's storage folder (a fresh one by default). */
	readonly storage?: string;
	readonly agent?: Partial<AgentOptions>;
	/** Waits for the server service to be ready (when the window shows and terms are accepted). */
	readonly waitForServer?: boolean;
	/**
	 * Each plugin's own folder, where its host assets resolve (so the kernel
	 * expands `${resources}` to `<folder>/resources`); others have no assets.
	 */
	readonly pluginRoots?: Readonly<Record<string, string>>;
}

export interface BootedAgent {
	readonly kernel: MainKernel;
	readonly server: FakeServer;
	readonly storage: string;
	/** kilo.core's own sdk, to call what only kilo.core may. */
	readonly coreSdk: PluginSdk;
	readonly chats: FakeKiloChats;
	readonly consent: DomainObjectProvider<typeof KernelDataCollection>;
	setTermsAccepted(accepted: boolean): void;
	setSignedIn(signedIn: boolean): void;
	setExternalApps(on: boolean): void;
}

export const serviceStatus = (kernel: MainKernel, key: string) =>
	kernel.kernelSdk.domainObjects.get(KernelServices)!.getState().services[key]?.status;

/**
 * Boots a real main kernel with kilo.core running only its agent area, on a
 * fake Kilo server and chat client. The rest of kilo.core is stood in for:
 * the terms context key, a `kilo.core/account` whose sign-in the test sets,
 * and a flag source for External AI apps.
 */
export async function bootAgent(options: BootOptions = {}): Promise<BootedAgent> {
	const chats = options.chats ?? new FakeKiloChats();
	const storage = options.storage ?? (await tempDir());
	let server: FakeServer | undefined;
	let coreSdk: PluginSdk | undefined;
	let account: DomainObjectProvider<typeof KiloAccount> | undefined;
	let flags: Record<string, FlagValue> = { [EXTERNAL_AI_APPS_FLAG]: options.externalApps ?? false };
	const flagListeners = new Set<() => void>();

	const entry = definePlugin({
		activate: async (sdk) => {
			coreSdk = sdk;
			sdk.context.set("termsAccepted", options.termsAccepted ?? true);
			account = sdk.domainObjects.provide(KiloAccount, {
				initialState: accountState(options.signedIn ?? true),
				methods: {
					signIn: async () => ({ signedIn: true }),
					cancelSignIn: () => undefined,
					signOut: () => undefined,
					refresh: () => undefined,
					setOrganization: () => undefined,
				},
			});
			sdk.extensions.implement(KernelFlagSource, "launchdarkly", {
				values: () => flags,
				subscribe: (listener) => {
					flagListeners.add(listener);
					return () => flagListeners.delete(listener);
				},
				identify: () => undefined,
			});
			await activateAgent(sdk, {
				createServer: (input) => (server = new FakeServer(input)),
				createChatClient: () => chats,
				userConfigDirectory: path.join(storage, "user-config"),
				envRestartDebounceMs: 5,
				...options.agent,
			});
		},
	});
	const kernel = createMainKernel({
		host: createTestHost({ rendererOrigins: ["kilo-desktop://app"] }),
		registrations: [{ manifest, definitions: CORE_DEFINITIONS, entry }, ...(options.plugins ?? [])],
		hostServices: (pluginId) => {
			const root = options.pluginRoots?.[pluginId];
			return {
				storage: createMemoryStorage(storage),
				...(root ? { assets: { resolve: (subpath: string) => path.join(root, subpath) } } : {}),
			};
		},
	});
	const consent = kernel.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: {
			choice: true,
			allowed: true,
			installationId: "install-1",
			environment: "stable",
		},
		methods: { setChoice: () => {} },
	});
	await kernel.start();
	cleanups.push(() => kernel.stop());
	if (options.showWindow !== false) await kernel.windowShown();
	if (options.waitForServer) {
		await eventually(() => {
			if (serviceStatus(kernel, "kilo.core/server") !== "ready") throw new Error("not ready");
		});
	}
	return {
		kernel,
		server: server!,
		storage,
		coreSdk: coreSdk!,
		chats,
		consent,
		setTermsAccepted: (accepted) => coreSdk!.context.set("termsAccepted", accepted),
		setSignedIn: (signedIn) => account!.update((state) => ({ ...state, signedIn })),
		setExternalApps: (on) => {
			flags = { ...flags, [EXTERNAL_AI_APPS_FLAG]: on };
			for (const listener of [...flagListeners]) listener();
		},
	};
}
