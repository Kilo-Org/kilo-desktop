import { describe, expect, it, vi } from "vitest";

import {
	KernelIdentity,
	KernelIdentityProvider,
	KernelLinkedAccount,
	type AccountInput,
	type AccountSource,
} from "../builtins";
import { testPlugin } from "../test-fixtures";
import { createTestHost } from "../testing";
import { createMainKernel } from "./main-kernel";

/** An account source whose account the test changes. */
function accountSource(initial: AccountInput | null) {
	let account = initial;
	const listeners = new Set<() => void>();
	const source: AccountSource = {
		current: () => account,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		source,
		set(next: AccountInput | null) {
			account = next;
			for (const listener of listeners) listener();
		},
		listeners,
	};
}

function accountPlugin(
	id: string,
	point: typeof KernelIdentityProvider | typeof KernelLinkedAccount,
	source: AccountSource,
) {
	return testPlugin(id, {
		manifest: { contributes: { extensions: { [point.id]: [{ id: "account" }] } } },
		entry: { activate: (sdk) => void sdk.extensions.implement(point, "account", source) },
	});
}

describe("kernel/identity", () => {
	it("is anonymous without an identity provider", async () => {
		const kernel = createMainKernel({ registrations: [], host: createTestHost() });
		await kernel.start();

		expect(kernel.kernelSdk.domainObjects.get(KernelIdentity)!.getState()).toEqual({
			primary: null,
			linked: [],
		});
	});

	it("follows the identity provider's account", async () => {
		const kilo = accountSource(null);
		const kernel = createMainKernel({
			registrations: [accountPlugin("acme.account", KernelIdentityProvider, kilo.source)],
			host: createTestHost(),
		});
		await kernel.start();
		const identity = kernel.kernelSdk.domainObjects.get(KernelIdentity)!;
		const changed = vi.fn();
		identity.on("changed", changed);

		kilo.set({ id: "u1", email: "ada@example.com", organization: { id: "o1" } });

		expect(identity.getState().primary).toEqual({
			id: "u1",
			email: "ada@example.com",
			organization: { id: "o1" },
			attributes: {},
			source: "acme.account/account",
		});
		expect(changed).toHaveBeenCalledTimes(1);

		kilo.set(null);
		expect(identity.getState().primary).toBeNull();
	});

	it("adds linked accounts in contribution order and drops them when their plugin stops", async () => {
		const first = accountSource({ id: "a1", attributes: { plan: "pro" } });
		const second = accountSource({ id: "b1" });
		const kernel = createMainKernel({
			registrations: [
				accountPlugin("acme.first", KernelLinkedAccount, first.source),
				accountPlugin("acme.second", KernelLinkedAccount, second.source),
			],
			host: createTestHost(),
		});
		await kernel.start();
		const identity = kernel.kernelSdk.domainObjects.get(KernelIdentity)!;

		expect(identity.getState().linked).toEqual([
			{ id: "a1", attributes: { plan: "pro" }, source: "acme.first/account" },
			{ id: "b1", attributes: {}, source: "acme.second/account" },
		]);

		second.set(null);
		expect(identity.getState().linked.map((account) => account.id)).toEqual(["a1"]);

		await kernel.stop();
		expect(identity.getState().linked).toEqual([]);
		expect(first.listeners.size).toBe(0);
	});

	it("treats an invalid account as no account", async () => {
		const broken = accountSource({ id: "" });
		const error = vi.fn();
		const kernel = createMainKernel({
			registrations: [accountPlugin("acme.account", KernelIdentityProvider, broken.source)],
			host: createTestHost(),
			logger: { debug() {}, info() {}, warn() {}, error },
		});
		await kernel.start();

		expect(kernel.kernelSdk.domainObjects.get(KernelIdentity)!.getState().primary).toBeNull();
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("acme.account/account"),
			expect.anything(),
		);
	});
});
