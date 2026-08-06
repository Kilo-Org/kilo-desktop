import type { AuthSession } from "@anaconda-agentic-desktop/contracts";

import type { AuthSessionService } from "../auth/auth-service.js";
import type { FeatureFlagContext, FeatureFlagProvider } from "./types.js";
import { FREE_SUBSCRIPTION } from "../auth/utils.js";

export const ANONYMOUS_CONTEXT: FeatureFlagContext = { isEmployee: false };

/** Derives a {@link FeatureFlagContext} from the current auth session; never throws. */
export async function deriveContext(auth: AuthSessionService): Promise<FeatureFlagContext> {
	// The two reads are independent (getSubscription does not depend on the
	// resolved session), so issue them concurrently; each falls back on error.
	const [session, subscription] = await Promise.all([
		auth.getSession().catch((): AuthSession => {
			return { status: "error", reason: "Unable to retrieve user session" };
		}),
		auth.getSubscription().catch(() => FREE_SUBSCRIPTION),
	]);

	if (session.status !== "authenticated") return ANONYMOUS_CONTEXT;

	const isEmployee = session.user.email?.split("@")[1]?.toLowerCase() === "anaconda.com";
	const userId = session.user.userId;

	return { isEmployee, userId, subscription };
}

/** Re-identify the provider on login/logout so flags re-evaluate. Returns an unsubscribe. */
export function bindAuthToProvider(
	auth: AuthSessionService,
	provider: FeatureFlagProvider,
	onError: (cause: unknown) => void,
): () => void {
	return auth.onChanged(() => {
		deriveContext(auth)
			.then((context) => provider.identify(context))
			.catch(onError);
	});
}
