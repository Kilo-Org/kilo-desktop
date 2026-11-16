import type { KiloProfile } from "../../contracts";
import type { KiloAccountClient } from "./account-service";

/** The account packaged e2e builds report as signed in (origin's test identity). */
export const E2E_PROFILE: KiloProfile = {
	profile: { email: "e2e@kilo.dev", name: "E2E", hasPersonalAccount: true },
	balance: null,
	kiloPass: null,
	currentOrgId: null,
};

/**
 * Test seam for packaged e2e only. `package:e2e` bakes `VITE_KILO_E2E_AUTH=1`
 * into the binary; a production build has no such value, so this is false
 * there. Launching an e2e build with `KILO_E2E_SIGNED_OUT=1` reads the real
 * account instead (its isolated profile has no credentials: signed out).
 */
export function isE2eSignedIn(
	buildFlag: string | undefined = import.meta.env.VITE_KILO_E2E_AUTH,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return buildFlag === "1" && env["KILO_E2E_SIGNED_OUT"] !== "1";
}

/**
 * Reports the fixed e2e account as signed in. Everything else (sign-in,
 * sign-out, organizations) still reaches the Kilo server, whose own
 * credentials stay empty — gates that ask the account open, the CLI does not.
 */
export function withE2eIdentity(client: KiloAccountClient): KiloAccountClient {
	return {
		...client,
		authStatus: async () => ({ authenticated: true }),
		profile: async () => E2E_PROFILE,
	};
}
