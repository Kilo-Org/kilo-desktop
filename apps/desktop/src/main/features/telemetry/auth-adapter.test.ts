import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@anaconda-agentic-desktop/contracts";

import type { UserInfoAttribute } from "../auth/actions.js";
import { AuthSessionTelemetryAdapter, type AuthSessionSlice } from "./auth-adapter.js";

function fakeAuth(overrides: Partial<AuthSessionSlice> = {}): AuthSessionSlice & {
	emitChange: () => void;
} {
	const listeners = new Set<(session: AuthSession) => void>();
	return {
		getSession: overrides.getSession ?? (async () => ({ status: "anonymous" }) as AuthSession),
		getApiKey: overrides.getApiKey ?? (async () => null),
		getUserInfo: overrides.getUserInfo ?? (async () => [] as UserInfoAttribute[]),
		onChanged:
			overrides.onChanged ??
			((listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			}),
		emitChange() {
			for (const listener of listeners) listener({ status: "anonymous" });
		},
	};
}

function adapter(auth: AuthSessionSlice, now = () => 0): AuthSessionTelemetryAdapter {
	return new AuthSessionTelemetryAdapter({ auth, now });
}

describe("AuthSessionTelemetryAdapter", () => {
	it("resolves identity for an authenticated anaconda employee with a subscription", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
			getUserInfo: async () => [{ id: "business_subscription.org", group: "subscriptions" }],
		});

		const identity = await adapter(auth).getIdentity("never");

		expect(identity).toEqual({
			userId: "u1",
			isEmployee: true,
			cohortId: 0,
			subscription: "business_subscription",
		});
	});

	it("marks a non-anaconda email as not an employee and free tier without attributes", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u2", email: "person@example.com" },
			}),
		});

		const identity = await adapter(auth).getIdentity("never");

		expect(identity).toEqual({
			userId: "u2",
			isEmployee: false,
			cohortId: 0,
			subscription: "free_subscription",
		});
	});

	it("returns anonymous identity when anonymize is 'always' (no userinfo call)", async () => {
		const getUserInfo = vi.fn(async () => []);
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
			getUserInfo,
		});

		const identity = await adapter(auth).getIdentity("always");

		expect(identity).toEqual({ isEmployee: false });
		expect(getUserInfo).not.toHaveBeenCalled();
	});

	it("returns anonymous identity for an anonymous session", async () => {
		expect(await adapter(fakeAuth()).getIdentity("never")).toEqual({ isEmployee: false });
	});

	it("omits subscription when getUserInfo throws (never throws)", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
			getUserInfo: async () => {
				throw new Error("boom");
			},
		});

		const identity = await adapter(auth).getIdentity("never");

		expect(identity.subscription).toBeUndefined();
		expect(identity.userId).toBe("u1");
	});

	it("caches the resolved identity across calls", async () => {
		const getSession = vi.fn(async () => ({
			status: "authenticated" as const,
			user: { userId: "u1", email: "dev@anaconda.com" },
		}));
		const getUserInfo = vi.fn(async () => []);
		const instance = adapter(fakeAuth({ getSession, getUserInfo }));

		await instance.getIdentity("never");
		await instance.getIdentity("never");

		expect(getSession).toHaveBeenCalledTimes(1);
		expect(getUserInfo).toHaveBeenCalledTimes(1);
	});

	it("invalidates the cache on an auth change", async () => {
		const getSession = vi.fn(async () => ({
			status: "authenticated" as const,
			user: { userId: "u1", email: "dev@anaconda.com" },
		}));
		const auth = fakeAuth({ getSession });
		const instance = adapter(auth);

		await instance.getIdentity("never");
		auth.emitChange();
		await instance.getIdentity("never");

		expect(getSession).toHaveBeenCalledTimes(2);
	});

	it("returns null api key when auth throws", async () => {
		const auth = fakeAuth({
			getApiKey: async () => {
				throw new Error("locked");
			},
		});

		expect(await adapter(auth).getApiKey()).toBeNull();
	});

	it("returns anonymous identity when getSession throws", async () => {
		const auth = fakeAuth({
			getSession: async () => {
				throw new Error("session error");
			},
		});

		expect(await adapter(auth).getIdentity("never")).toEqual({ isEmployee: false });
	});

	it("treats a user without an email as a non-employee", async () => {
		const auth = fakeAuth({
			getSession: async () => ({ status: "authenticated", user: { userId: "u3" } }),
		});

		const identity = await adapter(auth).getIdentity("never");
		expect(identity.isEmployee).toBe(false);
		expect(identity.userId).toBe("u3");
	});

	it("forwards onChanged subscriptions to the listener", () => {
		const auth = fakeAuth();
		const listener = vi.fn();
		const stop = adapter(auth).onChanged(listener);

		auth.emitChange();
		expect(listener).toHaveBeenCalledTimes(1);

		stop();
		auth.emitChange();
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
