import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@anaconda-agentic-desktop/contracts";

import type { AuthSessionService } from "../auth/auth-service.js";
import { FREE_SUBSCRIPTION, type UserSubscription } from "../auth/utils.js";
import { ANONYMOUS_CONTEXT, deriveContext } from "./auth-adapter.js";

function makeAuth(overrides: {
	session: AuthSession | (() => Promise<AuthSession>);
	subscription?: UserSubscription | (() => Promise<UserSubscription>);
}): AuthSessionService {
	const session = overrides.session;
	const subscription = overrides.subscription ?? FREE_SUBSCRIPTION;
	return {
		getSession: vi.fn(typeof session === "function" ? session : async () => session),
		getSubscription: vi.fn(
			typeof subscription === "function" ? subscription : async () => subscription,
		),
	} as unknown as AuthSessionService;
}

const authenticatedSession: AuthSession = {
	status: "authenticated",
	user: { userId: "u1", email: "dev@anaconda.com" },
};

describe("deriveContext", () => {
	it("issues both auth reads concurrently (no serialization dependency)", async () => {
		let releaseSession: (() => void) | undefined;
		const auth = makeAuth({
			// Block the session read until we've confirmed the subscription read
			// was already issued — a serial implementation would await the
			// session first and never call getSubscription in the meantime.
			session: () =>
				new Promise<AuthSession>((resolve) => {
					releaseSession = () => resolve(authenticatedSession);
				}),
			subscription: async () => "business_subscription",
		});

		const pending = deriveContext(auth);

		expect(auth.getSession).toHaveBeenCalledTimes(1);
		expect(auth.getSubscription).toHaveBeenCalledTimes(1);

		releaseSession?.();
		await expect(pending).resolves.toEqual({
			isEmployee: true,
			userId: "u1",
			subscription: "business_subscription",
		});
	});

	it("returns the anonymous context when unauthenticated", async () => {
		const auth = makeAuth({ session: { status: "anonymous" } });

		await expect(deriveContext(auth)).resolves.toEqual(ANONYMOUS_CONTEXT);
	});

	it("falls back on read failures without throwing", async () => {
		const auth = makeAuth({
			session: () => Promise.reject(new Error("keyring locked")),
			subscription: () => Promise.reject(new Error("network")),
		});

		await expect(deriveContext(auth)).resolves.toEqual(ANONYMOUS_CONTEXT);
	});

	it("defaults the subscription to free when that read rejects", async () => {
		const auth = makeAuth({
			session: authenticatedSession,
			subscription: () => Promise.reject(new Error("network")),
		});

		await expect(deriveContext(auth)).resolves.toEqual({
			isEmployee: true,
			userId: "u1",
			subscription: FREE_SUBSCRIPTION,
		});
	});
});
