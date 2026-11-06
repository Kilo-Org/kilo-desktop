// Helpers for testing plugins against a real kernel pair over in-memory transports.
import {
	createMainKernel,
	type MainKernel,
	type MainKernelHost,
	type MainKernelOptions,
} from "../main/main-kernel";
import type { KernelLogger } from "../sdk";
import type { PluginRegistration } from "../plugin";
import { createLinkedTransports } from "../transport";
import {
	createRendererKernel,
	type RendererKernel,
	type RendererWindow,
} from "../web/renderer-kernel";

export { testManifest, testPlugin } from "../test-fixtures";
import type { KvStore, KvStoreOptions, PluginStorage } from "../host-services";

export function createTestHost(overrides: Partial<MainKernelHost> = {}): MainKernelHost {
	return {
		platform: "mac",
		version: "0.0.0-test",
		desktop: false,
		confirm: async () => true,
		quit: () => {},
		relaunch: () => {},
		...overrides,
	};
}

export interface TestKernelPair {
	readonly main: MainKernel;
	readonly renderer: RendererKernel;
	/**
	 * Boots another window's renderer kernel on the same main, as a pop-out window gets;
	 * pass `window` to give it a role (a `secondary` window sets `kernel/secondaryWindow`).
	 */
	readonly openWindow: (
		windowId: string,
		window?: Omit<RendererWindow, "id">,
	) => Promise<RendererKernel>;
}

/** Boots a main and one renderer kernel linked in memory, with plugins activated. */
export async function createTestKernelPair(options: {
	readonly main: readonly PluginRegistration[];
	readonly renderer: readonly PluginRegistration[];
	readonly host?: MainKernelHost;
	readonly mainHostServices?: MainKernelOptions["hostServices"];
	/** Paths for files dropped on the test window. */
	readonly pathForFile?: (file: File) => string | null;
	/** Receives both kernels' logs (plugin activation failures, crashed contributions…). */
	readonly logger?: KernelLogger;
}): Promise<TestKernelPair> {
	const transports = createLinkedTransports();
	const main = createMainKernel({
		host: options.host ?? createTestHost(),
		transport: transports.main,
		registrations: options.main,
		webPlugins: webPluginIds(options.renderer),
		...(options.mainHostServices ? { hostServices: options.mainHostServices } : {}),
		...(options.logger ? { logger: options.logger } : {}),
	});
	await main.start();
	const openWindow = async (windowId: string, window?: Omit<RendererWindow, "id">) => {
		const renderer = createRendererKernel({
			windowId,
			...(window ? { window } : {}),
			platform: "mac",
			transport: transports.connectRenderer(windowId),
			registrations: options.renderer,
			...(options.pathForFile ? { pathForFile: options.pathForFile } : {}),
			...(options.logger ? { logger: options.logger } : {}),
		});
		await renderer.activate();
		await main.flush();
		return renderer;
	};
	const renderer = await openWindow("main");
	return { main, renderer, openWindow };
}

function webPluginIds(registrations: readonly PluginRegistration[]): string[] {
	return registrations.flatMap((registration) => {
		const id = (registration.manifest as { id?: unknown } | null)?.id;
		return registration.entry && typeof id === "string" ? [id] : [];
	});
}

/** In-memory plugin storage: `kv` namespaces survive across kernels that share it. */
export function createMemoryStorage(dir = "/memory"): PluginStorage & {
	readonly saved: Map<string, Record<string, unknown>>;
} {
	const saved = new Map<string, Record<string, unknown>>();
	return {
		dir,
		saved,
		kv<T extends Record<string, unknown>>(options: KvStoreOptions<T>): KvStore<T> {
			const key = options.namespace ?? "default";
			const read = () =>
				({ ...options.defaults, ...(saved.get(key) as Partial<T> | undefined) }) as T;
			return {
				snapshot: read,
				get: (name) => read()[name],
				set: (patch) => {
					saved.set(key, { ...read(), ...patch });
					return read();
				},
				clear: () => void saved.delete(key),
			};
		},
	};
}
