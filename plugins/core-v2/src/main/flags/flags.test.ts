import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	flagKey,
	KernelFlags,
	KernelIdentityProvider,
	KernelLinkedAccount,
	type AccountInput,
	type AccountSource,
} from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import { CORE_DEFINITIONS } from "../../contracts";
import { activateFlags } from "./index";
import type { FeatureFlagEvents, FeatureFlagProvider } from "./types";

class FakeProvider extends EventEmitter<FeatureFlagEvents> implements FeatureFlagProvider {
	flags: Record<string, unknown>;
	readonly identify = vi.fn(async () => {});
	readonly dispose = vi.fn(async () => {});

	constructor(flags: Record<string, unknown> = {}) {
		super();
		this.flags = flags;
	}

	start = async () => "complete" as const;
	getAllFlags = () => this.flags;

	/** LaunchDarkly pushed new values. */
	change(flags: Record<string, unknown>): void {
		this.flags = flags;
		this.emit("change");
	}
}

/** An account whose sign-in the test drives. */
function fakeAccount(initial: AccountInput | null) {
	let current = initial;
	const listeners = new Set<() => void>();
	const source: AccountSource = {
		current: () => current,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		source,
		set(next: AccountInput | null) {
			current = next;
			for (const listener of listeners) listener();
		},
	};
}

const ADA: AccountInput = {
	id: "ada@anaconda.com",
	email: "ada@anaconda.com",
	organization: { id: "org-1", name: "Analytical Engines" },
	attributes: { isEmployee: true },
};

async function boot(
	provider: FeatureFlagProvider,
	options: { primary?: AccountInput | null; linked?: AccountInput | null } = {},
) {
	const primary = fakeAccount(options.primary ?? null);
	const linked = fakeAccount(options.linked ?? null);
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			{
				manifest,
				definitions: CORE_DEFINITIONS,
				entry: definePlugin({
					activate(sdk) {
						// The account area's identity provider, as kilo.core activates it first.
						sdk.extensions.implement(KernelIdentityProvider, "kilo-account", primary.source);
						activateFlags(sdk, { createProvider: () => provider });
					},
				}),
			},
			testPlugin("acme.board", {
				manifest: {
					contributes: {
						extensions: {
							"kernel/flag": [
								{ id: "beta", description: "Beta board.", default: false },
								{ id: "gamma", description: "Gamma board.", default: false },
								{ id: "theme", description: "Board theme.", default: "red" },
							],
						},
					},
				},
				entry: { activate: () => {} },
			}),
			testPlugin("kilo.anaconda", {
				manifest: {
					contributes: { extensions: { "kernel/linked-account": [{ id: "anaconda" }] } },
				},
				entry: {
					activate: (sdk) =>
						void sdk.extensions.implement(KernelLinkedAccount, "anaconda", linked.source),
				},
			}),
		],
	});
	await kernel.start();
	const flags = kernel.kernelSdk.domainObjects.get(KernelFlags)!;
	await vi.waitFor(() => expect(flags.getState().ready).toBe(true));
	const value = (id: string) => flags.getState().flags[id]?.value;
	return { kernel, flags, value, primary, linked, context: kernel.kernelSdk.context };
}

describe("LaunchDarkly as the flag source", () => {
	it("answers every declared flag once LaunchDarkly has answered", async () => {
		const provider = new FakeProvider({ beta: true, theme: "blue", undeclared: true });
		const { flags, value } = await boot(provider);

		expect(value("beta")).toBe(true);
		expect(value("theme")).toBe("blue");
		expect(flags.getState().flags["beta"]?.origin).toBe("source");
		expect(flags.getState().flags).not.toHaveProperty("undeclared");
		expect(provider.identify).toHaveBeenCalledWith({ isEmployee: false });
	});

	it("follows changes, including flags that disappear", async () => {
		const provider = new FakeProvider({ beta: true });
		const { value, context } = await boot(provider);

		provider.change({ gamma: true });

		await vi.waitFor(() => expect(value("gamma")).toBe(true));
		expect(value("beta")).toBe(false);
		expect(context.get(flagKey("beta"))).toBe(false);
		expect(context.get(flagKey("gamma"))).toBe(true);
	});

	it("ignores values that aren't booleans, strings or numbers", async () => {
		const { value } = await boot(new FakeProvider({ theme: { colour: "blue" } }));

		expect(value("theme")).toBe("red");
	});

	it("falls back to defaults rather than failing when the provider breaks", async () => {
		const provider = new FakeProvider();
		provider.getAllFlags = () => {
			throw new Error("cache corrupt");
		};
		provider.identify.mockRejectedValueOnce(new Error("offline"));
		const { flags, value } = await boot(provider);

		expect(flags.getState().ready).toBe(true);
		expect(value("theme")).toBe("red");
	});

	it("closes the provider when the app stops", async () => {
		const provider = new FakeProvider();
		const { kernel } = await boot(provider);

		await kernel.stop();

		expect(provider.dispose).toHaveBeenCalledOnce();
	});

	it("identifies the primary account, keyed on its id, with its organization", async () => {
		const provider = new FakeProvider();
		await boot(provider, { primary: ADA });

		expect(provider.identify).toHaveBeenLastCalledWith({
			isEmployee: true,
			userId: "ada@anaconda.com",
			email: "ada@anaconda.com",
			organization: { id: "org-1", name: "Analytical Engines" },
		});
	});

	it("identifies a personal account without an organization", async () => {
		const provider = new FakeProvider();
		await boot(provider, {
			primary: { id: "grace@example.com", email: "grace@example.com", attributes: {} },
		});

		expect(provider.identify).toHaveBeenLastCalledWith({
			isEmployee: false,
			userId: "grace@example.com",
			email: "grace@example.com",
		});
	});

	it("adds linked accounts as contexts named after their plugin", async () => {
		const provider = new FakeProvider();
		await boot(provider, {
			linked: {
				id: "anaconda-user-1",
				email: "ada@example.com",
				organization: { id: "acme" },
				attributes: { plan: "business" },
			},
		});

		expect(provider.identify).toHaveBeenLastCalledWith({
			isEmployee: false,
			linkedAccounts: [
				{
					kind: "kilo.anaconda",
					key: "anaconda-user-1",
					email: "ada@example.com",
					organization: { id: "acme" },
					attributes: { plan: "business" },
				},
			],
		});
	});

	it("follows sign-in and sign-out, but not a refresh of the same account", async () => {
		const provider = new FakeProvider();
		const { primary } = await boot(provider);
		expect(provider.identify).toHaveBeenLastCalledWith({ isEmployee: false });

		primary.set(ADA);
		await vi.waitFor(() =>
			expect(provider.identify).toHaveBeenLastCalledWith(
				expect.objectContaining({ email: "ada@anaconda.com" }),
			),
		);
		const calls = provider.identify.mock.calls.length;
		primary.set({ ...ADA });
		expect(provider.identify).toHaveBeenCalledTimes(calls);

		primary.set(null);
		await vi.waitFor(() =>
			expect(provider.identify).toHaveBeenLastCalledWith({ isEmployee: false }),
		);
	});
});
