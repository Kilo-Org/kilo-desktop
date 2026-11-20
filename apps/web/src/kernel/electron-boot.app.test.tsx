import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createLinkedTransports,
	definePlugin,
	KernelCommand,
	type KernelBridge,
	type TransportResult,
} from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createTestHost, testManifest } from "@kilo-desktop/kernel/testing";

import { bootKernel } from "./boot";

const manifest = testManifest("acme.keys", {
	contributes: {
		extensions: {
			"kernel/command": [{ id: "go", title: "Go", keybinding: "Alt+G", repeatable: true }],
		},
	},
});

/** A preload bridge backed by an in-memory main kernel, as the desktop preload would provide. */
async function fakeDesktop() {
	const transports = createLinkedTransports();
	const main = createMainKernel({
		host: createTestHost(),
		transport: transports.main,
		registrations: [{ manifest }],
	});
	await main.start();
	const renderer = transports.connectRenderer("main");
	const shortcutListeners = new Set<(chord: string) => void>();
	const synced: unknown[] = [];
	transports.main.on("kernel:keyboard-sync", (payload) => void synced.push(payload));
	const bridge: KernelBridge = {
		window: { id: "main", role: "main", params: {} },
		platform: "mac",
		async request(channel, payload): Promise<TransportResult> {
			try {
				return { ok: true, value: await renderer.request(channel, payload) };
			} catch (error) {
				const { code, message } = error as { code: never; message: string };
				return { ok: false, error: { code, message } };
			}
		},
		send: (channel, payload) => renderer.send(channel, payload),
		on(listener) {
			const offs = [
				"kernel:domain-provided",
				"kernel:domain-state",
				"kernel:domain-event",
				"kernel:domain-withdrawn",
				"kernel:context",
				"kernel:implementations",
				"kernel:command-run",
			].map((channel) => renderer.on(channel, (payload) => listener(channel, payload)));
			return () => offs.forEach((off) => off());
		},
		onShortcut(listener) {
			shortcutListeners.add(listener);
			return () => shortcutListeners.delete(listener);
		},
		getPathForFile: (file) => `/dropped/${file.name}`,
	};
	return {
		main,
		bridge,
		synced,
		press: (chord: string) => shortcutListeners.forEach((listener) => listener(chord)),
	};
}

afterEach(() => {
	delete (globalThis as { kernelBridge?: KernelBridge }).kernelBridge;
});

describe("kernel boot (desktop)", () => {
	it("syncs live shortcuts to main's capture and runs the command main reports", async () => {
		const desktop = await fakeDesktop();
		(globalThis as { kernelBridge?: KernelBridge }).kernelBridge = desktop.bridge;
		const run = vi.fn();

		await bootKernel({
			bundled: [{ manifest }],
			webEntries: {
				"acme.keys": definePlugin({
					activate: (sdk) => {
						sdk.extensions.implement(KernelCommand, "go", run);
					},
				}),
			},
		});

		await expect
			.poll(() => desktop.synced.at(-1))
			.toEqual({ bindings: [{ chord: "Alt+KeyG", repeatable: true }], recording: false });
		desktop.press("Alt+KeyG");
		await expect.poll(() => run).toHaveBeenCalledOnce();
	});

	it("resolves dropped files through the preload and keeps booting past a plugin that fails", async () => {
		const desktop = await fakeDesktop();
		(globalThis as { kernelBridge?: KernelBridge }).kernelBridge = desktop.bridge;
		vi.spyOn(console, "error").mockImplementation(() => {});

		const { kernel } = await bootKernel({
			bundled: [{ manifest }],
			webEntries: {
				"acme.keys": definePlugin({
					activate: () => {
						throw new Error("broken plugin");
					},
				}),
			},
		});

		expect(kernel.pathForFile(new File(["x"], "data.csv"))).toBe("/dropped/data.csv");
		expect(kernel.pluginState("acme.keys")).toBe("failed");
	});
});
