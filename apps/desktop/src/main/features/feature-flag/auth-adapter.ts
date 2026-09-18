import type { AuthSession, AuthUser } from "@kilo-desktop/contracts";

import type { AuthSessionService } from "../auth/auth-service.js";
import type { UserInfoOrganization } from "../auth/actions.js";
import type {
	FeatureFlagContext,
	FeatureFlagOrganizationContext,
	FeatureFlagProvider,
} from "./types.js";
import { FREE_SUBSCRIPTION, isAnacondaEmployee } from "../auth/utils.js";

export const ANONYMOUS_CONTEXT: FeatureFlagContext = { isEmployee: false };

/** Derives a {@link FeatureFlagContext} from the current auth session; never throws. */
export async function deriveContext(auth: AuthSessionService): Promise<FeatureFlagContext> {
	// The three reads are independent of each other, so issue them concurrently;
	// each falls back on error so `deriveContext` never rejects.
	const [session, subscription, organizations] = await Promise.all([
		auth.getSession().catch((): AuthSession => {
			return { status: "error", reason: "Unable to retrieve user session" };
		}),
		auth.getSubscription().catch(() => FREE_SUBSCRIPTION),
		auth.getOrganizations().catch((): UserInfoOrganization[] => []),
	]);

	if (session.status !== "authenticated") return ANONYMOUS_CONTEXT;

	const { user } = session;
	const isEmployee = isAnacondaEmployee(user.email);
	const context: FeatureFlagContext = { isEmployee, subscription };
	if (user.userId !== undefined) context.userId = user.userId;
	if (user.email !== undefined) context.email = user.email;
	if (user.username !== undefined) context.username = user.username;
	if (user.firstName !== undefined) context.firstName = user.firstName;
	if (user.lastName !== undefined) context.lastName = user.lastName;

	const name = fullName(user);
	if (name !== undefined) context.name = name;

	const organization = primaryOrganization(organizations);
	if (organization !== undefined) context.organization = organization;

	return context;
}

/** `firstName lastName` when both present; otherwise whichever is; otherwise username. */
function fullName(user: AuthUser): string | undefined {
	const parts = [user.firstName, user.lastName].filter(
		(part): part is string => typeof part === "string" && part.length > 0,
	);
	if (parts.length > 0) return parts.join(" ");
	return user.username;
}

/**
 * Picks the first organization with a stable `id` — LaunchDarkly requires a key
 * for every context and rejects contexts without one, so an org without an id
 * is not modeled at all.
 */
function primaryOrganization(
	organizations: readonly UserInfoOrganization[],
): FeatureFlagOrganizationContext | undefined {
	for (const org of organizations) {
		if (!org.id) continue;
		const context: FeatureFlagOrganizationContext = { id: org.id };
		if (org.name != null) context.name = org.name;
		if (org.role != null) context.role = org.role;
		return context;
	}
	return undefined;
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
