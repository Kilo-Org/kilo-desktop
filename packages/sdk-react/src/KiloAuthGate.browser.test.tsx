import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";

import { createTestShellDelegates } from "./test-helpers.js";
import { KiloAuthGate } from "./KiloAuthGate.js";

afterEach(cleanup);

function renderGate(auth: Partial<SDK["auth"]>) {
	const delegates = createTestShellDelegates();
	const sdk = {
		auth: { ...delegates.auth, ...auth },
		plugins: { get: () => null },
	} as unknown as SDK;
	return render(
		<KiloAuthGate
			featureId="test"
			featureName="Test Feature"
			pendingFallback={<div>Page skeleton</div>}
			sdkOverride={sdk}
		>
			<div>Gated content</div>
		</KiloAuthGate>,
	);
}

const AUTHENTICATED: AuthSession = { status: "authenticated", user: { email: "ada@example.com" } };
const ANONYMOUS: AuthSession = { status: "anonymous" };

/**
 * Auth store whose `refresh()` stays pending until the test settles it, and
 * publishes the settled session to subscribers like the real delegate does.
 */
function createDeferredRefreshAuth(cached: AuthSession) {
	let session = cached;
	const listeners = new Set<(next: AuthSession) => void>();
	let settleRefresh: (next: AuthSession) => void = () => undefined;
	const refresh = vi.fn(
		() =>
			new Promise<AuthSession>((resolve) => {
				settleRefresh = (next) => {
					session = next;
					for (const fn of [...listeners]) fn(next);
					resolve(next);
				};
			}),
	);
	return {
		auth: {
			subscribe: (fn: (next: AuthSession) => void) => {
				listeners.add(fn);
				return () => {
					listeners.delete(fn);
				};
			},
			peek: () => session,
			getSession: async () => session,
			refresh,
		},
		refresh,
		settleRefresh: (next: AuthSession) => settleRefresh(next),
	};
}

describe("KiloAuthGate", () => {
	it("renders gated content immediately from a cached authenticated session", async () => {
		const store = createDeferredRefreshAuth(AUTHENTICATED);
		renderGate(store.auth);

		// Asserted on the first commit: the gate's 5s safety timeout would
		// otherwise eventually reveal content even without trusting the cache.
		expect(page.getByText("Gated content").query()).not.toBeNull();
		expect(page.getByTestId("kilo-auth-gate-pending").query()).toBeNull();
		expect(store.refresh).toHaveBeenCalled();
	});

	it("swaps to the sign-in surface when the background refresh finds the cache stale", async () => {
		const store = createDeferredRefreshAuth(AUTHENTICATED);
		renderGate(store.auth);
		expect(page.getByText("Gated content").query()).not.toBeNull();

		store.settleRefresh(ANONYMOUS);

		await expect.element(page.getByTestId("kilo-auth-gate-signin")).toBeVisible();
		expect(page.getByText("Gated content").query()).toBeNull();
	});

	it("waits for the first refresh when no authenticated session is cached", async () => {
		const store = createDeferredRefreshAuth(ANONYMOUS);
		renderGate(store.auth);

		// An anonymous cache may itself be stale (signed in since boot), so the
		// gate must not flash the sign-in surface before the first fresh read.
		expect(page.getByText("Page skeleton").query()).not.toBeNull();
		expect(page.getByText("Loading…").query()).toBeNull();
		expect(page.getByTestId("kilo-auth-gate-signin").query()).toBeNull();

		store.settleRefresh(AUTHENTICATED);

		await expect.element(page.getByText("Gated content")).toBeVisible();
	});

	it("clears when sign-in completes via the auth subscription", async () => {
		let session: AuthSession = { status: "anonymous" };
		const listeners = new Set<(next: AuthSession) => void>();
		renderGate({
			subscribe: (fn: (next: AuthSession) => void) => {
				listeners.add(fn);
				return () => {
					listeners.delete(fn);
				};
			},
			peek: () => session,
			getSession: async () => session,
			refresh: async () => session,
		});

		await expect.element(page.getByTestId("kilo-auth-gate-signin")).toBeVisible();
		expect(page.getByText("Gated content").query()).toBeNull();

		// Sign-in completes elsewhere; the subscription re-evaluates the gate.
		session = { status: "authenticated", user: { email: "ada@example.com" } };
		for (const fn of [...listeners]) fn(session);

		await expect.element(page.getByText("Gated content")).toBeVisible();
	});
});
