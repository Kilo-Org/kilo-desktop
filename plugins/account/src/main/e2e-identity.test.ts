import { describe, expect, it, vi } from "vitest";

import { E2E_PROFILE, isE2eSignedIn, withE2eIdentity } from "./e2e-identity";
import type { KiloAccountClient } from "./identity";

describe("the packaged e2e identity", () => {
	it("is on only in e2e builds that weren't launched signed out", () => {
		expect(isE2eSignedIn("1", {})).toBe(true);
		expect(isE2eSignedIn("1", { KILO_E2E_SIGNED_OUT: "1" })).toBe(false);
		expect(isE2eSignedIn(undefined, {})).toBe(false);
		expect(isE2eSignedIn("0", {})).toBe(false);
	});

	it("reports the fixed account and passes everything else to the server", async () => {
		const signOut = vi.fn(async () => {});
		const server = {
			authStatus: async () => ({ authenticated: false }),
			profile: async () => {
				throw new Error("not signed in");
			},
			signOut,
		} as unknown as KiloAccountClient;

		const client = withE2eIdentity(server);

		await expect(client.authStatus()).resolves.toEqual({ authenticated: true });
		await expect(client.profile()).resolves.toEqual(E2E_PROFILE);
		await client.signOut();
		expect(signOut).toHaveBeenCalledOnce();
	});
});
