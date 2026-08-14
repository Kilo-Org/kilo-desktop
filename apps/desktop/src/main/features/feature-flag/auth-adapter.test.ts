import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@anaconda-agentic-desktop/contracts";

import type { AuthSessionService } from "../auth/auth-service.js";
import type { UserInfoOrganization } from "../auth/actions.js";
import { FREE_SUBSCRIPTION, type UserSubscription } from "../auth/utils.js";
import { ANONYMOUS_CONTEXT, bindAuthToProvider, deriveContext } from "./auth-adapter.js";
import type { FeatureFlagProvider } from "./types.js";

function makeAuth(overrides: {
	session: AuthSession | (() => Promise<AuthSession>);
	subscription?: UserSubscription | (() => Promise<UserSubscription>);
	organizations?: UserInfoOrganization[] | (() => Promise<UserInfoOrganization[]>);
}): AuthSessionService {
	const session = overrides.session;
	const subscription = overrides.subscription ?? FREE_SUBSCRIPTION;
	const organizations = overrides.organizations ?? [];
	return {
		getSession: vi.fn(typeof session === "function" ? session : async () => session),
		getSubscription: vi.fn(
			typeof subscription === "function" ? subscription : async () => subscription,
		),
		getOrganizations: vi.fn(
			typeof organizations === "function" ? organizations : async () => organizations,
		),
	} as unknown as AuthSessionService;
}

const authenticatedSession: AuthSession = {
	status: "authenticated",
	user: {
		userId: "u1",
		username: "ada",
		email: "dev@anaconda.com",
		firstName: "Ada",
		lastName: "Lovelace",
	},
};

describe("deriveContext", () => {
	it("issues all auth reads concurrently (no serialization dependency)", async () => {
		let releaseSession: (() => void) | undefined;
		const auth = makeAuth({
			// Block the session read until we've confirmed the other reads were
			// already issued — a serial implementation would await the session
			// first and never call the others in the meantime.
			session: () =>
				new Promise<AuthSession>((resolve) => {
					releaseSession = () => resolve(authenticatedSession);
				}),
			subscription: async () => "business_subscription",
			organizations: async () => [{ id: "org-1", name: "Acme", role: "admin" }],
		});

		const pending = deriveContext(auth);

		expect(auth.getSession).toHaveBeenCalledTimes(1);
		expect(auth.getSubscription).toHaveBeenCalledTimes(1);
		expect(auth.getOrganizations).toHaveBeenCalledTimes(1);

		releaseSession?.();
		await expect(pending).resolves.toEqual({
			isEmployee: true,
			userId: "u1",
			username: "ada",
			email: "dev@anaconda.com",
			firstName: "Ada",
			lastName: "Lovelace",
			name: "Ada Lovelace",
			subscription: "business_subscription",
			organization: { id: "org-1", name: "Acme", role: "admin" },
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
			organizations: () => Promise.reject(new Error("network")),
		});

		await expect(deriveContext(auth)).resolves.toEqual(ANONYMOUS_CONTEXT);
	});

	it("defaults the subscription to free when that read rejects", async () => {
		const auth = makeAuth({
			session: authenticatedSession,
			subscription: () => Promise.reject(new Error("network")),
		});

		await expect(deriveContext(auth)).resolves.toMatchObject({
			isEmployee: true,
			userId: "u1",
			subscription: FREE_SUBSCRIPTION,
		});
	});

	it("omits the organization when the read rejects", async () => {
		const auth = makeAuth({
			session: authenticatedSession,
			organizations: () => Promise.reject(new Error("network")),
		});

		const context = await deriveContext(auth);
		expect(context.organization).toBeUndefined();
	});

	it("skips organizations without an id and picks the first with one", async () => {
		const auth = makeAuth({
			session: authenticatedSession,
			organizations: async () => [
				{ name: "No-id org" },
				{ id: "org-2", name: "Second" },
				{ id: "org-3", name: "Third" },
			],
		});

		await expect(deriveContext(auth)).resolves.toMatchObject({
			organization: { id: "org-2", name: "Second" },
		});
	});

	it("uses username as name when first/last name are absent", async () => {
		const auth = makeAuth({
			session: {
				status: "authenticated",
				user: { userId: "u2", username: "grace", email: "grace@example.com" },
			},
		});

		await expect(deriveContext(auth)).resolves.toMatchObject({
			userId: "u2",
			name: "grace",
			username: "grace",
			email: "grace@example.com",
			isEmployee: false,
		});
	});

	it("omits the name when neither name parts nor username exist", async () => {
		const auth = makeAuth({
			session: {
				status: "authenticated",
				user: { userId: "svc-1" },
			},
		});

		const context = await deriveContext(auth);
		expect(context.name).toBeUndefined();
		expect(context.username).toBeUndefined();
	});
});

describe("bindAuthToProvider", () => {
	function makeChangeableAuth(session: AuthSession) {
		let listener: (() => void) | undefined;
		const unsubscribe = vi.fn();
		const auth = {
			getSession: vi.fn(async () => session),
			getSubscription: vi.fn(async () => FREE_SUBSCRIPTION),
			getOrganizations: vi.fn(async () => [] as UserInfoOrganization[]),
			onChanged: vi.fn((fn: () => void) => {
				listener = fn;
				return unsubscribe;
			}),
		} as unknown as AuthSessionService;
		return { auth, unsubscribe, fire: () => listener?.() };
	}

	function makeProvider(): FeatureFlagProvider & { identify: ReturnType<typeof vi.fn> } {
		return { identify: vi.fn() } as unknown as FeatureFlagProvider & {
			identify: ReturnType<typeof vi.fn>;
		};
	}

	it("re-identifies the provider with a derived context when auth changes", async () => {
		const { auth, fire } = makeChangeableAuth(authenticatedSession);
		const provider = makeProvider();
		const onError = vi.fn();

		bindAuthToProvider(auth, provider, onError);
		fire();
		await vi.waitFor(() => expect(provider.identify).toHaveBeenCalledTimes(1));

		expect(provider.identify).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "u1", isEmployee: true }),
		);
		expect(onError).not.toHaveBeenCalled();
	});

	it("forwards a provider.identify rejection to onError", async () => {
		const { auth, fire } = makeChangeableAuth(authenticatedSession);
		const provider = makeProvider();
		const cause = new Error("LD down");
		provider.identify.mockRejectedValueOnce(cause);
		const onError = vi.fn();

		bindAuthToProvider(auth, provider, onError);
		fire();

		await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
		expect(onError).toHaveBeenCalledWith(cause);
	});

	it("returns the unsubscribe handle from auth.onChanged", () => {
		const { auth, unsubscribe } = makeChangeableAuth(authenticatedSession);
		const dispose = bindAuthToProvider(auth, makeProvider(), vi.fn());

		dispose();

		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
