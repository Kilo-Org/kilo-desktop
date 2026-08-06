import type { AuthSession } from "@anaconda-agentic-desktop/contracts";

import type { AuthSessionService } from "../auth/auth-service.js";
import type { FeatureFlagContext, FeatureFlagProvider } from "./types.js";
import { FREE_SUBSCRIPTION } from "../auth/utils.js";

export const ANONYMOUS_CONTEXT: FeatureFlagContext = { isEmployee: false };

/** Derives a {@link FeatureFlagContext} from the current auth session; never throws. */
export async function deriveContext(auth: AuthSessionService): Promise<FeatureFlagContext> {
	const session: AuthSession = await auth.getSession().catch(() => {
		return { status: "error", reason: "Unable to retrieve user session" };
	});

	if (session.status !== "authenticated") return ANONYMOUS_CONTEXT;

	const isEmployee = session.user.email?.split("@")[1]?.toLowerCase() === "anaconda.com";
	const userId = session.user.userId;
	const subscription = await auth.getSubscription().catch(() => FREE_SUBSCRIPTION);

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
