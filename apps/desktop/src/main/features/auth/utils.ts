import type { ValueOf } from "type-fest";
import type { UserInfoAttribute } from "./actions.js";

export const SUBSCRIPTION_TIERS = {
	free: "free_subscription",
	starter: "starter_subscription",
	business: "business_subscription",
	commercial: "commercial_subscription",
	security: "security_subscription",
	enterprise: "enterprise_subscription",
	platform: "platform_subscription",
} as const;

export type UserSubscription = ValueOf<typeof SUBSCRIPTION_TIERS>;

export const FREE_SUBSCRIPTION: UserSubscription = SUBSCRIPTION_TIERS.free;

/** True when the email's domain is `anaconda.com` (case-insensitive). */
export function isAnacondaEmployee(email?: string): boolean {
	return email?.split("@")[1]?.toLowerCase() === "anaconda.com";
}

const SUBSCRIPTION_SET = new Set<string>(Object.values(SUBSCRIPTION_TIERS));

/**
 * Keeps `group === "subscriptions"` attributes, takes the `id` prefix before the
 * first `.` (`"business_subscription.org-id"` → `"business_subscription"`), and
 * drops anything not in {@link SUBSCRIPTION_TIERS}.
 */
export function extractSubscriptionsFromAttributes(
	attributes: readonly UserInfoAttribute[] = [],
): UserSubscription[] {
	return attributes
		.filter((attr) => attr.group === "subscriptions")
		.map((attr) => attr.id.split(".")[0])
		.filter((tier): tier is UserSubscription => tier !== undefined && SUBSCRIPTION_SET.has(tier));
}

/** First non-free tier if present, otherwise `free_subscription`. */
export function getPrimarySubscription(
	subscriptions: readonly UserSubscription[],
): UserSubscription {
	return subscriptions.find((sub) => sub !== FREE_SUBSCRIPTION) ?? FREE_SUBSCRIPTION;
}

/** Everyone implicitly has `free_subscription`; reduce attributes to the primary tier. */
export function primarySubscriptionFromAttributes(
	attributes: readonly UserInfoAttribute[],
): UserSubscription {
	return getPrimarySubscription([
		FREE_SUBSCRIPTION,
		...extractSubscriptionsFromAttributes(attributes),
	]);
}
