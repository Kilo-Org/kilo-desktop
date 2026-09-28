import type { AuthSession } from "@kilo-desktop/contracts";

import type { AuthSessionService } from "../auth/auth-service.js";
import type {
	FeatureFlagContext,
	FeatureFlagOrganizationContext,
	FeatureFlagProvider,
} from "./types.js";
import { isAnacondaEmployee } from "../auth/utils.js";

export const ANONYMOUS_CONTEXT: FeatureFlagContext = { isEmployee: false };

/** Derives a {@link FeatureFlagContext} from the current auth session; never throws. */
export async function deriveContext(auth: AuthSessionService): Promise<FeatureFlagContext> {
	// The three reads are independent of each other, so issue them concurrently;
	// each falls back on error so `deriveContext` never rejects.
	const session = await auth.getSession().catch((): AuthSession => {
		return { status: "error", reason: "Unable to retrieve user session" };
	});

	if (session.status !== "authenticated") return ANONYMOUS_CONTEXT;

	const { user } = session;
	const context: FeatureFlagContext = { isEmployee: isAnacondaEmployee(user.email) };
	if (user.email !== undefined) {
		context.email = user.email;
		// The Kilo profile has no separate user id; the email is the only stable
		// per-user value, and already reaches LaunchDarkly as a built-in
		// attribute — so key the context on it. Otherwise every signed-in user
		// collapses into key "anonymous" and per-user targeting/rollouts break.
		context.userId = user.email;
	}

	const organization = organizationContext(user.org);
	if (organization !== undefined) context.organization = organization;

	return context;
}

/**
 * Maps the Kilo current-org to a LaunchDarkly organization context. LaunchDarkly
 * requires a key for every context, so an org without an id is dropped.
 */
function organizationContext(
	org: { id?: string | undefined; name?: string | undefined } | undefined,
): FeatureFlagOrganizationContext | undefined {
	if (!org?.id) return undefined;
	const context: FeatureFlagOrganizationContext = { id: org.id };
	if (org.name != null) context.name = org.name;
	return context;
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
