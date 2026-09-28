import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@kilo-desktop/contracts";

import type { AuthSessionService } from "../auth/auth-service.js";
import { ANONYMOUS_CONTEXT, bindAuthToProvider, deriveContext } from "./auth-adapter.js";
import type { FeatureFlagProvider } from "./types.js";

function makeAuth(session: AuthSession | (() => Promise<AuthSession>)): AuthSessionService {
	return {
		getSession: vi.fn(typeof session === "function" ? session : async () => session),
	} as unknown as AuthSessionService;
}

const authenticatedSession: AuthSession = {
	status: "authenticated",
	user: { email: "dev@anaconda.com", org: { id: "org-1", name: "Acme" } },
};

describe("deriveContext", () => {
	it("derives the context from the session email and org", async () => {
		const auth = makeAuth(authenticatedSession);

		await expect(deriveContext(auth)).resolves.toEqual({
			isEmployee: true,
			email: "dev@anaconda.com",
			userId: "dev@anaconda.com",
			organization: { id: "org-1", name: "Acme" },
		});
	});

	it("returns the anonymous context when unauthenticated", async () => {
		const auth = makeAuth({ status: "anonymous" });

		await expect(deriveContext(auth)).resolves.toEqual(ANONYMOUS_CONTEXT);
	});

	it("returns the anonymous context when the session read rejects", async () => {
		const auth = makeAuth(() => Promise.reject(new Error("sidecar down")));

		await expect(deriveContext(auth)).resolves.toEqual(ANONYMOUS_CONTEXT);
	});

	it("omits the organization when the profile has no current org", async () => {
		const auth = makeAuth({
			status: "authenticated",
			user: { email: "dev@example.com" },
		});

		const context = await deriveContext(auth);
		expect(context.organization).toBeUndefined();
	});

	it("drops an org without an id (LaunchDarkly requires a key)", async () => {
		const auth = makeAuth({
			status: "authenticated",
			user: { email: "dev@example.com", org: { name: "No-id org" } },
		});

		const context = await deriveContext(auth);
		expect(context.organization).toBeUndefined();
	});

	it("marks non-anaconda emails as not employees", async () => {
		const auth = makeAuth({
			status: "authenticated",
			user: { email: "person@example.com" },
		});

		await expect(deriveContext(auth)).resolves.toMatchObject({ isEmployee: false });
	});
});

describe("bindAuthToProvider", () => {
	function makeChangeableAuth(session: AuthSession) {
		let listener: (() => void) | undefined;
		const unsubscribe = vi.fn();
		const auth = {
			getSession: vi.fn(async () => session),
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
			expect.objectContaining({ email: "dev@anaconda.com", isEmployee: true }),
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
