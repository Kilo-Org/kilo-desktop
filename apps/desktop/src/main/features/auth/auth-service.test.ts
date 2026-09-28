import { describe, expect, it, vi } from "vitest";

import {
	AuthSessionService,
	createKiloIdentityReader,
	type KiloIdentityReader,
} from "./auth-service.js";

function identity(partial: Partial<KiloIdentityReader>): KiloIdentityReader {
	return {
		isAuthenticated: async () => false,
		getIdentity: async () => null,
		available: async () => true,
		...partial,
	};
}

describe("AuthSessionService (Kilo-backed)", () => {
	it("resolves an anonymous session when the user is not signed in to Kilo", async () => {
		const service = new AuthSessionService({
			kiloIdentity: identity({ isAuthenticated: async () => false }),
		});
		await expect(service.getSession()).resolves.toEqual({ status: "anonymous" });
	});

	it("resolves an authenticated session from the Kilo profile email", async () => {
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => true,
				getIdentity: async () => ({ email: "dev@example.com" }),
			}),
		});
		await expect(service.getSession()).resolves.toEqual({
			status: "authenticated",
			user: { email: "dev@example.com" },
		});
	});

	it("includes the current org in the session user when present", async () => {
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => true,
				getIdentity: async () => ({
					email: "dev@example.com",
					org: { id: "org-1", name: "Acme" },
				}),
			}),
		});
		const session = await service.getSession();
		expect(session).toEqual({
			status: "authenticated",
			user: { email: "dev@example.com", org: { id: "org-1", name: "Acme" } },
		});
	});

	it("degrades to anonymous when the authenticated profile has no email", async () => {
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => true,
				getIdentity: async () => ({}),
			}),
		});
		await expect(service.getSession()).resolves.toEqual({ status: "anonymous" });
	});

	it("returns an error session when the identity read fails", async () => {
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => true,
				getIdentity: async () => {
					throw new Error("sidecar down");
				},
			}),
		});
		const session = await service.getSession();
		expect(session.status).toBe("error");
	});

	it("re-resolves a transient getIdentity failure once the source recovers", async () => {
		// isAuthenticated succeeds (source up) but the profile fetch throws once —
		// a transient hiccup must not pin the session at "error" forever.
		let profileCalls = 0;
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => true,
				available: async () => true,
				getIdentity: async () => {
					profileCalls++;
					if (profileCalls === 1) throw new Error("transient");
					return { email: "dev@example.com" };
				},
			}),
		});

		const first = await service.getSession();
		expect(first.status).toBe("error");

		// Next getSession re-resolves (transient error was flagged) and recovers.
		await expect(service.getSession()).resolves.toEqual({
			status: "authenticated",
			user: { email: "dev@example.com" },
		});
	});

	it("never throws when the auth-status read fails — degrades to anonymous", async () => {
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => {
					throw new Error("sidecar down");
				},
			}),
		});
		await expect(service.getSession()).resolves.toEqual({ status: "anonymous" });
	});

	it("caches the resolved session until refresh()", async () => {
		const isAuthenticated = vi.fn(async () => true);
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated,
				getIdentity: async () => ({ email: "dev@example.com" }),
			}),
		});
		await service.getSession();
		await service.getSession();
		expect(isAuthenticated).toHaveBeenCalledTimes(1);

		await service.refresh();
		expect(isAuthenticated).toHaveBeenCalledTimes(2);
	});

	it("notifies subscribers when the session transitions", async () => {
		let authed = false;
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => authed,
				getIdentity: async () => ({ email: "dev@example.com" }),
			}),
		});
		const seen: string[] = [];
		service.onChanged((s) => seen.push(s.status));

		await service.getSession(); // anonymous
		authed = true;
		await service.refresh(); // authenticated

		expect(seen).toEqual(["authenticated"]);
	});

	it("login()/logout() re-resolve against the current Kilo state", async () => {
		let authed = false;
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated: async () => authed,
				getIdentity: async () => ({ email: "dev@example.com" }),
			}),
		});
		authed = true;
		await expect(service.login()).resolves.toEqual({
			status: "authenticated",
			user: { email: "dev@example.com" },
		});
		authed = false;
		await expect(service.logout()).resolves.toEqual({ status: "anonymous" });
	});

	it("re-resolves a boot-time anonymous once the sidecar becomes available", async () => {
		// Simulate the boot race: source unavailable at first resolution, then up.
		let up = false;
		const isAuthenticated = vi.fn(async () => up);
		const service = new AuthSessionService({
			kiloIdentity: identity({
				isAuthenticated,
				getIdentity: async () => ({ email: "dev@example.com" }),
				available: async () => up,
			}),
		});

		// Boot: source down → anonymous, marked transient.
		await expect(service.getSession()).resolves.toEqual({ status: "anonymous" });

		// Source comes up; next getSession re-resolves instead of serving the cache.
		up = true;
		await expect(service.getSession()).resolves.toEqual({
			status: "authenticated",
			user: { email: "dev@example.com" },
		});
	});

	it("does not re-resolve a genuine (source-up) anonymous", async () => {
		const isAuthenticated = vi.fn(async () => false);
		const service = new AuthSessionService({
			kiloIdentity: identity({ isAuthenticated, available: async () => true }),
		});
		await service.getSession();
		await service.getSession();
		expect(isAuthenticated).toHaveBeenCalledTimes(1);
	});
});

describe("createKiloIdentityReader", () => {
	const connection = { baseUrl: "http://127.0.0.1:59632", password: "secret" };

	function fetchReturning(body: unknown, ok = true) {
		return vi.fn(async () => ({
			ok,
			json: async () => body,
		})) as unknown as (
			input: string,
			init?: { headers?: Record<string, string> },
		) => Promise<Response>;
	}

	it("reads auth-status's authenticated flag", async () => {
		const fetch = fetchReturning({ authenticated: true, type: "oauth" });
		const reader = createKiloIdentityReader(async () => connection, fetch);
		await expect(reader.isAuthenticated()).resolves.toBe(true);
	});

	it("maps the nested profile payload to identity email and current org", async () => {
		const fetch = fetchReturning({
			profile: {
				email: "dev@example.com",
				organizations: [
					{ id: "org-1", name: "Acme", role: "admin" },
					{ id: "org-2", name: "Other", role: "member" },
				],
			},
			currentOrgId: "org-2",
		});
		const reader = createKiloIdentityReader(async () => connection, fetch);
		await expect(reader.getIdentity()).resolves.toEqual({
			email: "dev@example.com",
			org: { id: "org-2", name: "Other" },
		});
	});

	it("falls back to selectedOrganizationId when currentOrgId is null", async () => {
		const fetch = fetchReturning({
			profile: {
				email: "dev@example.com",
				organizations: [{ id: "org-1", name: "Acme", role: "admin" }],
				selectedOrganizationId: "org-1",
			},
			currentOrgId: null,
		});
		const reader = createKiloIdentityReader(async () => connection, fetch);
		await expect(reader.getIdentity()).resolves.toEqual({
			email: "dev@example.com",
			org: { id: "org-1", name: "Acme" },
		});
	});

	it("returns null identity when the profile fetch fails", async () => {
		const fetch = fetchReturning({}, false);
		const reader = createKiloIdentityReader(async () => connection, fetch);
		await expect(reader.getIdentity()).resolves.toBeNull();
	});

	it("reports unauthenticated and null when there is no connection", async () => {
		const reader = createKiloIdentityReader(async () => null, fetchReturning({}));
		await expect(reader.isAuthenticated()).resolves.toBe(false);
		await expect(reader.getIdentity()).resolves.toBeNull();
	});
});
