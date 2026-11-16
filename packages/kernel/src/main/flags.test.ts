import { describe, expect, it, vi } from "vitest";

import {
	KernelFlags,
	KernelFlagSource,
	KernelIdentityProvider,
	type AccountInput,
	type FlagSource,
	type FlagValue,
	type IdentityState,
} from "../builtins";
import type { PluginRegistration } from "../plugin";
import { testPlugin } from "../test-fixtures";
import { createTestHost, createTestKernelPair } from "../testing";
import { createMainKernel, type MainKernelHost } from "./main-kernel";

/** A flag source whose values the test sets; null until it has answered. */
function fakeSource(initial: Record<string, FlagValue> | null = null) {
	let values = initial;
	const listeners = new Set<() => void>();
	const identities: IdentityState[] = [];
	const source: FlagSource = {
		values: () => values,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		identify: (identity) => void identities.push(identity),
	};
	return {
		source,
		identities,
		set(next: Record<string, FlagValue>) {
			values = next;
			for (const listener of listeners) listener();
		},
	};
}

function declaring(id: string, flags: Record<string, unknown>[], extra = {}): PluginRegistration {
	return testPlugin(id, {
		manifest: { contributes: { extensions: { "kernel/flag": flags } }, ...extra },
		entry: { activate: () => {} },
	});
}

function sourcePlugin(source: FlagSource): PluginRegistration {
	return testPlugin("acme.flags", {
		manifest: { contributes: { extensions: { "kernel/flag-source": [{ id: "remote" }] } } },
		entry: { activate: (sdk) => void sdk.extensions.implement(KernelFlagSource, "remote", source) },
	});
}

async function boot(registrations: PluginRegistration[], host: Partial<MainKernelHost> = {}) {
	const kernel = createMainKernel({ registrations, host: createTestHost(host) });
	await kernel.start();
	await kernel.flush();
	return { kernel, flags: kernel.kernelSdk.domainObjects.get(KernelFlags)! };
}

const BOARD = { id: "board", description: "The workspace board." };

describe("kernel/flags", () => {
	it("gives every declared flag its default, ready at once without a flag source", async () => {
		const { kernel, flags } = await boot([
			declaring("acme.board", [BOARD, { id: "limit", description: "Max", default: 3 }]),
		]);

		expect(flags.getState()).toEqual({
			ready: true,
			flags: {
				board: {
					value: false,
					default: false,
					description: "The workspace board.",
					pluginId: "acme.board",
					origin: "default",
				},
				limit: {
					value: 3,
					default: 3,
					description: "Max",
					pluginId: "acme.board",
					origin: "default",
				},
			},
		});
		expect(flags.lookup("limit")).toMatchObject({ value: 3 });
		expect(kernel.contextKeys.get("kernel/flag:board")).toBe(false);
	});

	it("takes declared flags' values from the flag source once it answers", async () => {
		const remote = fakeSource();
		const { kernel, flags } = await boot([
			declaring("acme.board", [BOARD]),
			sourcePlugin(remote.source),
		]);
		const changed = vi.fn();
		flags.on("changed", changed);

		expect(flags.getState().ready).toBe(false);

		remote.set({ board: true, undeclared: true });

		expect(flags.getState().ready).toBe(true);
		expect(flags.lookup("board")).toMatchObject({ value: true, origin: "source" });
		expect(flags.lookup("undeclared")).toBeNull();
		expect(kernel.contextKeys.get("kernel/flag:board")).toBe(true);
		expect(changed).toHaveBeenCalledWith({ ids: ["board"] });

		remote.set({});
		expect(flags.lookup("board")).toMatchObject({ value: false, origin: "default" });
		expect(kernel.contextKeys.get("kernel/flag:board")).toBe(false);
	});

	it("asks the flag source to evaluate for the identity, and again when it changes", async () => {
		const remote = fakeSource({});
		let account: AccountInput | null = null;
		const listeners = new Set<() => void>();
		const identityPlugin = testPlugin("acme.account", {
			manifest: { contributes: { extensions: { "kernel/identity-provider": [{ id: "me" }] } } },
			entry: {
				activate: (sdk) =>
					void sdk.extensions.implement(KernelIdentityProvider, "me", {
						current: () => account,
						subscribe: (listener) => {
							listeners.add(listener);
							return () => listeners.delete(listener);
						},
					}),
			},
		});
		await boot([identityPlugin, sourcePlugin(remote.source)]);

		account = { id: "u1" };
		for (const listener of listeners) listener();

		expect(remote.identities.map((identity) => identity.primary?.id ?? null)).toEqual([null, "u1"]);
	});

	it("lets the host's overrides win over the flag source", async () => {
		const remote = fakeSource({ board: false });
		const { flags } = await boot([declaring("acme.board", [BOARD]), sourcePlugin(remote.source)], {
			flagOverrides: { board: true },
		});

		expect(flags.lookup("board")).toMatchObject({ value: true, origin: "override" });
	});

	it("keeps the first declaration of a flag id", async () => {
		const warn = vi.fn();
		const kernel = createMainKernel({
			registrations: [
				declaring("acme.first", [BOARD]),
				declaring("acme.second", [{ id: "board", description: "Again", default: true }]),
			],
			host: createTestHost(),
			logger: { debug() {}, info() {}, warn, error() {} },
		});
		await kernel.start();

		expect(kernel.kernelSdk.domainObjects.get(KernelFlags)!.lookup("board")).toMatchObject({
			pluginId: "acme.first",
			value: false,
		});
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('"board"'));
	});

	it("starts a plugin behind its own flag once the flag source turns it on", async () => {
		const remote = fakeSource();
		const activate = vi.fn();
		const gated = testPlugin("acme.developer", {
			manifest: {
				when: { all: ["kernel/flag:developer"] },
				contributes: {
					extensions: { "kernel/flag": [{ id: "developer", description: "Developer tools." }] },
				},
			},
			entry: { activate },
		});
		const { kernel } = await boot([gated, sourcePlugin(remote.source)]);
		expect(kernel.pluginState("acme.developer")).toBe("inactive");

		remote.set({ developer: true });
		await kernel.flush();

		expect(kernel.pluginState("acme.developer")).toBe("active");
		expect(activate).toHaveBeenCalledTimes(1);
	});

	it("mirrors flags and their context keys to windows", async () => {
		const remote = fakeSource({ board: true });
		const { renderer } = await createTestKernelPair({
			main: [declaring("acme.board", [BOARD]), sourcePlugin(remote.source)],
			renderer: [],
		});

		expect(renderer.kernelSdk.domainObjects.get(KernelFlags)!.lookup("board")).toMatchObject({
			value: true,
		});
		expect(renderer.contextKeys.get("kernel/flag:board")).toBe(true);
	});
});
