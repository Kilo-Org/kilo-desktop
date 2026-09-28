import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";

import { createTestShellDelegates } from "./test-helpers.js";
import { useSignIn } from "./useSignIn.js";

type SignInState = ReturnType<typeof useSignIn>;

function renderHook(auth: Partial<SDK["auth"]> = {}, telemetry: Partial<SDK["telemetry"]> = {}) {
	const delegates = createTestShellDelegates();
	const sdk = {
		auth: { ...delegates.auth, ...auth },
		telemetry: { ...delegates.telemetry, ...telemetry },
	};
	let state: SignInState | undefined;
	function Probe() {
		state = useSignIn(sdk);
		return null;
	}
	const view = render(<Probe />);
	return {
		getState: () => state!,
		rerender: () => view.rerender(<Probe />),
	};
}

function sessionStore(initial: AuthSession) {
	let session = initial;
	const listeners = new Set<(next: AuthSession) => void>();
	return {
		auth: {
			subscribe(listener: (next: AuthSession) => void) {
				listeners.add(listener);
				listener(session);
				return () => listeners.delete(listener);
			},
			peek: () => session,
		},
		authenticate(next: AuthSession) {
			session = next;
			for (const listener of listeners) listener(session);
		},
	};
}

afterEach(cleanup);

describe("useSignIn", () => {
	it("reports the current session and authentication state", () => {
		const store = sessionStore({ status: "authenticated", user: { username: "ada" } });
		const { getState } = renderHook(store.auth);
		expect(getState().session).toEqual({ status: "authenticated", user: { username: "ada" } });
		expect(getState().authenticated).toBe(true);
	});

	it("resolves true, updates the session, and tracks Logged In on success", async () => {
		const store = sessionStore({ status: "anonymous" });
		const track = vi.fn(async () => {});
		const login = vi.fn(async (): Promise<AuthSession> => {
			store.authenticate({ status: "authenticated", user: { username: "ada" } });
			return store.auth.peek();
		});
		const { getState } = renderHook({ ...store.auth, login }, { track });

		const ok = await getState().signIn();

		expect(ok).toBe(true);
		expect(track).toHaveBeenCalledWith({ event: "Logged In" });
		expect(getState().authenticated).toBe(true);
		expect(getState().error).toBeUndefined();
		await vi.waitFor(() => {
			expect(getState().signingIn).toBe(false);
		});
	});

	it("resolves false and surfaces the reason when login errors", async () => {
		const store = sessionStore({ status: "anonymous" });
		const { getState } = renderHook({
			...store.auth,
			login: async (): Promise<AuthSession> => ({ status: "error", reason: "nope" }),
		});

		const ok = await getState().signIn();

		expect(ok).toBe(false);
		await vi.waitFor(() => {
			expect(getState().error).toBe("nope");
		});
		expect(getState().authenticated).toBe(false);
	});

	it("resolves false without an error when login ends anonymous", async () => {
		const store = sessionStore({ status: "anonymous" });
		const { getState } = renderHook(store.auth);

		const ok = await getState().signIn();

		expect(ok).toBe(false);
		expect(getState().error).toBeUndefined();
	});
});
