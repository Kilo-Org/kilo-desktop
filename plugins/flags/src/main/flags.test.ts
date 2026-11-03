import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import type { DomainProvider } from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { Identity, type IdentityState } from "@kilo-desktop/plugin-account/contracts";
import { createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { FLAGS_DEFINITIONS, Flags, flagKey } from "../contracts";
import type { FeatureFlagEvents, FeatureFlagProvider } from "./types";
import { createFlagsMainEntry } from "./index";

class FakeProvider extends EventEmitter<FeatureFlagEvents> implements FeatureFlagProvider {
	flags: Record<string, unknown>;
	readonly identify = vi.fn(async () => {});
	readonly dispose = vi.fn(async () => {});

	constructor(flags: Record<string, unknown> = {}) {
		super();
		this.flags = flags;
	}

	start = async () => "complete" as const;
	getFlag = <T>(key: string, fallback?: T) => (this.flags[key] ?? fallback) as T;
	getAllFlags = () => this.flags;

	/** LaunchDarkly pushed new values. */
	change(flags: Record<string, unknown>): void {
		this.flags = flags;
		this.emit("change");
	}
}

const SIGNED_OUT: IdentityState = {
	connection: "connected",
	authenticated: false,
	profile: null,
	profileError: null,
	deviceAuth: { status: "idle" },
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

const SIGNED_IN: IdentityState = {
	...SIGNED_OUT,
	authenticated: true,
	profile: {
		profile: {
			email: "ada@anaconda.com",
			name: "Ada",
			organizations: [{ id: "org-1", name: "Analytical Engines", role: "owner" }],
		},
		balance: null,
		kiloPass: null,
		currentOrgId: "org-1",
	},
};

/** Stands in for kilo.account: an identity the test drives. */
function fakeAccount(initial: IdentityState) {
	let identity: DomainProvider<typeof Identity> | undefined;
	return {
		registration: testPlugin("kilo.account", {
			manifest: { domains: [{ id: "identity", home: "main" }] },
			definitions: { domains: [Identity] },
			entry: {
				activate: (sdk) => {
					identity = sdk.domains.provide(Identity, {
						initialState: initial,
						methods: {
							signIn: async () => ({ signedIn: false }),
							cancelSignIn: () => {},
							signOut: () => {},
							refresh: () => {},
							setOrganization: () => {},
							dismissOrgError: () => {},
						},
					});
				},
			},
		}),
		set: (state: IdentityState) => identity?.setState(state),
	};
}

async function boot(
	provider: FeatureFlagProvider,
	overrides = "",
	account = fakeAccount(SIGNED_OUT),
) {
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			{
				manifest,
				definitions: FLAGS_DEFINITIONS,
				entry: createFlagsMainEntry({ createProvider: () => provider, overrides }),
			},
			testPlugin("acme.reader", { entry: { activate: () => {} } }),
			account.registration,
		],
	});
	await kernel.start();
	const flags = kernel.sdkFor("acme.reader").domains.get(Flags)!;
	await vi.waitFor(() => expect(flags.getState().ready).toBe(true));
	return { kernel, flags, context: kernel.sdkFor("acme.reader").context };
}

describe("kilo.flags", () => {
	it("publishes every flag once LaunchDarkly has answered", async () => {
		const provider = new FakeProvider({ "new-sidebar": true, theme: "blue" });
		const { flags } = await boot(provider);

		expect(flags.getState()).toEqual({
			flags: { "new-sidebar": true, theme: "blue" },
			ready: true,
		});
		expect(provider.identify).toHaveBeenCalledWith({ isEmployee: false });
	});

	it("turns overridden flags on whatever LaunchDarkly says", async () => {
		const { flags, context } = await boot(new FakeProvider({ beta: false }), "beta, extra");

		expect(flags.getState().flags).toMatchObject({ beta: true, extra: true });
		expect(context.get(flagKey("beta"))).toBe(true);
	});

	it("sets a flag: context key while a flag is true", async () => {
		const { context } = await boot(new FakeProvider({ on: true, off: false, text: "yes" }));

		expect(context.get(flagKey("on"))).toBe(true);
		expect(context.get(flagKey("off"))).toBe(false);
		expect(context.get(flagKey("text"))).toBe(false);
	});

	it("follows changes, including flags that disappear", async () => {
		const provider = new FakeProvider({ beta: true });
		const { flags, context } = await boot(provider);

		provider.change({ gamma: true });

		expect(flags.getState().flags).toEqual({ gamma: true });
		expect(context.get(flagKey("beta"))).toBe(false);
		expect(context.get(flagKey("gamma"))).toBe(true);
	});

	it("reads no flags rather than failing when the provider breaks", async () => {
		const provider = new FakeProvider();
		provider.getAllFlags = () => {
			throw new Error("cache corrupt");
		};
		provider.identify.mockRejectedValueOnce(new Error("offline"));
		const { flags } = await boot(provider);

		expect(flags.getState()).toEqual({ flags: {}, ready: true });
	});

	it("closes the provider when the app stops", async () => {
		const provider = new FakeProvider();
		const { kernel } = await boot(provider);

		await kernel.stop();

		expect(provider.dispose).toHaveBeenCalledOnce();
	});

	it("identifies the signed-in Kilo account, keyed on email, with its organization and not its name", async () => {
		const provider = new FakeProvider();
		await boot(provider, "", fakeAccount(SIGNED_IN));

		expect(provider.identify).toHaveBeenLastCalledWith({
			isEmployee: true,
			email: "ada@anaconda.com",
			userId: "ada@anaconda.com",
			organization: { id: "org-1", name: "Analytical Engines" },
		});
	});

	it("identifies a personal account without an organization", async () => {
		const provider = new FakeProvider();
		await boot(
			provider,
			"",
			fakeAccount({
				...SIGNED_IN,
				profile: {
					profile: { email: "grace@example.com" },
					balance: null,
					kiloPass: null,
					currentOrgId: null,
				},
			}),
		);

		expect(provider.identify).toHaveBeenLastCalledWith({
			isEmployee: false,
			email: "grace@example.com",
			userId: "grace@example.com",
		});
	});

	it("follows sign-in and sign-out", async () => {
		const provider = new FakeProvider();
		const account = fakeAccount(SIGNED_OUT);
		await boot(provider, "", account);
		expect(provider.identify).toHaveBeenLastCalledWith({ isEmployee: false });

		account.set(SIGNED_IN);
		await vi.waitFor(() =>
			expect(provider.identify).toHaveBeenLastCalledWith(
				expect.objectContaining({ email: "ada@anaconda.com" }),
			),
		);
		const calls = provider.identify.mock.calls.length;
		account.set({ ...SIGNED_IN, isRefreshing: true });
		expect(provider.identify).toHaveBeenCalledTimes(calls);

		account.set(SIGNED_OUT);
		await vi.waitFor(() =>
			expect(provider.identify).toHaveBeenLastCalledWith({ isEmployee: false }),
		);
	});
});
