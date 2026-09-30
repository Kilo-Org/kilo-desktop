import { afterEach, describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import { mainRegister, type ElectronNotebookHostServiceLike } from "./index.js";
import type { ElectronNotebookHostServiceOptions } from "./runtime/ElectronNotebookHostService.js";
import type { OpenTelemetryRegistration } from "./runtime/NotebookTelemetryPermission.js";

// Native exports spread into module.exports are visible through the CJS default.
const runtimeRoot = vi.hoisted(() => ({
	openTelemetryRegistration: undefined as OpenTelemetryRegistration | undefined,
}));
vi.mock("@runtimed/node", () => ({ default: runtimeRoot }));

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(disposals.splice(0).map((dispose) => dispose()));
	runtimeRoot.openTelemetryRegistration = undefined;
});

async function boot({
	flag = false,
	consent = true,
	missingPreferences = false,
	native = false,
} = {}) {
	const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "notebook" });
	disposals.push(() => mainSdk.disposeAsync());
	const preferencesSdk = createMainSdk("preferences");
	let listener: ((allowed: boolean) => void | Promise<void>) | undefined;
	const unsubscribe = vi.fn(() => {
		listener = undefined;
	});
	if (!missingPreferences)
		preferencesSdk.plugins.expose("preferences", {
			allowDataCollection: consent,
			onDidChangeAllowDataCollection(callback: NonNullable<typeof listener>) {
				listener = callback;
				return unsubscribe;
			},
		});
	const flagsSdk = createMainSdk("feature-flag");
	const getFlag = vi.fn((_key: string, _defaultValue: boolean): unknown => flag);
	flagsSdk.plugins.expose("featureFlag", { getFlag });
	const handle = {
		updatePermission: vi.fn(async (_allowed: boolean): Promise<void> => undefined),
		close: vi.fn(async (): Promise<void> => undefined),
	};
	const openTelemetryRegistration = vi.fn<OpenTelemetryRegistration>(async () => handle);
	let callbacks: ElectronNotebookHostServiceOptions;
	const hostService: ElectronNotebookHostServiceLike = {
		socketPath: "/tmp/notebook-telemetry.sock",
		start: vi.fn(async () => ({ status: "external" as const })),
		status: vi.fn(),
		openFile: vi.fn(),
		save: vi.fn(),
		setDefaultSaveDirectory: vi.fn(),
		connect: vi.fn(),
		dispose: vi.fn(async () => undefined),
	};
	await mainRegister(mainSdk, {
		createHostService: (options) => {
			callbacks = options;
			return hostService;
		},
		resolveRuntimedBinary: () => undefined,
		resolveRuntimedNodeEntry: () => undefined,
		resolveKiloPluginEntry: () => undefined,
		resolveBundleRoot: () => undefined,
		...(native ? {} : { openTelemetryRegistration }),
	});
	return {
		mainSdk,
		flagsSdk,
		getFlag,
		handle,
		hostService,
		openTelemetryRegistration,
		unsubscribe,
		connect: (id: string) => callbacks.onNotebookConnected?.({ notebookId: id, untitled: false }),
		disconnect: (id: string) => callbacks.onNotebookDisconnected?.(id),
		setConsent: async (allowed: boolean) => {
			await listener?.(allowed);
		},
	};
}

describe("notebook telemetry registration", () => {
	it("registers only live notebooks and awaits direct privacy withdrawal", async () => {
		const {
			connect,
			disconnect,
			handle,
			hostService,
			openTelemetryRegistration,
			setConsent,
			getFlag,
		} = await boot({ flag: true });
		expect(hostService.start).toHaveBeenCalledOnce();
		expect(openTelemetryRegistration).not.toHaveBeenCalled();
		expect(getFlag).toHaveBeenCalledWith("notebook-host-telemetry", false);
		connect("one");
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledWith(true));
		expect(openTelemetryRegistration).toHaveBeenCalledExactlyOnceWith({
			socketPath: "/tmp/notebook-telemetry.sock",
			hostId: "kilo-desktop",
			source: "app",
			allowed: false,
		});
		connect("two");
		disconnect("one");
		const closing = deferred<void>();
		handle.close.mockReturnValueOnce(closing.promise);
		const settled = vi.fn();
		const withdrawal = setConsent(false).then(settled);
		await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
		expect(settled).not.toHaveBeenCalled();
		closing.resolve();
		await withdrawal;
		expect(openTelemetryRegistration).toHaveBeenCalledOnce();
	});

	it.each([
		{ flag: false },
		{ flag: true, consent: false },
		{ flag: true, missingPreferences: true },
	])("does not register without both gates: %j", async (options) => {
		const { connect, mainSdk, openTelemetryRegistration } = await boot(options);
		connect("one");
		await mainSdk.disposeAsync();
		expect(openTelemetryRegistration).not.toHaveBeenCalled();
	});

	it("supports the shipped root without a registration export", async () => {
		const { connect, mainSdk, hostService, setConsent } = await boot({ flag: true, native: true });
		connect("one");
		await setConsent(true);
		await mainSdk.disposeAsync();
		expect(hostService.dispose).toHaveBeenCalledOnce();
	});

	it("loads a supported native export from the CommonJS package root", async () => {
		const handle = {
			updatePermission: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		runtimeRoot.openTelemetryRegistration = vi.fn(async () => handle);
		const { connect, setConsent } = await boot({ flag: true, native: true });
		connect("one");
		await setConsent(true);
		expect(handle.updatePermission).toHaveBeenCalledWith(true);
	});

	it("uses the latest asynchronous feature flag change", async () => {
		const { connect, flagsSdk, getFlag, handle, openTelemetryRegistration, setConsent } =
			await boot();
		connect("one");
		const stale = deferred<boolean>();
		const current = deferred<boolean>();
		getFlag.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
		flagsSdk.events.emit("changed", {});
		flagsSdk.events.emit("changed", {});
		await vi.waitFor(() => expect(getFlag).toHaveBeenCalledTimes(3));
		current.resolve(true);
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledWith(true));
		stale.resolve(false);
		await setConsent(true);
		expect(openTelemetryRegistration).toHaveBeenCalledOnce();
		getFlag.mockReturnValue(false);
		flagsSdk.events.emit("changed", {});
		await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
	});

	it("propagates a failed privacy revocation rather than acknowledging success", async () => {
		const { connect, handle, setConsent } = await boot({ flag: true });
		connect("one");
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledWith(true));
		handle.close.mockRejectedValueOnce(new Error("revoke not acknowledged"));
		await expect(setConsent(false)).rejects.toThrow("revoke not acknowledged");
	});

	it("awaits disposal revocation, unsubscribes, and cannot reopen after disposal", async () => {
		const {
			connect,
			mainSdk,
			flagsSdk,
			handle,
			hostService,
			unsubscribe,
			openTelemetryRegistration,
			setConsent,
		} = await boot({ flag: true });
		connect("one");
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledWith(true));
		const closing = deferred<void>();
		handle.close.mockReturnValueOnce(closing.promise);
		const disposal = mainSdk.disposeAsync();
		await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
		expect(hostService.dispose).not.toHaveBeenCalled();
		expect(unsubscribe).toHaveBeenCalledOnce();
		closing.resolve();
		await disposal;
		await setConsent(true);
		connect("late");
		flagsSdk.events.emit("changed", {});
		expect(hostService.dispose).toHaveBeenCalledOnce();
		expect(openTelemetryRegistration).toHaveBeenCalledOnce();
	});
});
