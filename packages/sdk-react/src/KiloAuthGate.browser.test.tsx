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
		<KiloAuthGate featureId="test" featureName="Test Feature" sdkOverride={sdk}>
			<div>Gated content</div>
		</KiloAuthGate>,
	);
}

describe("KiloAuthGate", () => {
	it("always refreshes before rendering, even from a cached authenticated snapshot", async () => {
		// A stale cached authenticated session must not flash gated content —
		// the gate resolves on its first fresh read regardless of the snapshot.
		const session: AuthSession = { status: "authenticated", user: { email: "ada@example.com" } };
		const refresh = vi.fn(async () => session);
		renderGate({
			subscribe: (fn: (next: AuthSession) => void) => {
				fn(session);
				return () => undefined;
			},
			peek: () => session,
			getSession: async () => session,
			refresh,
		});

		await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
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
