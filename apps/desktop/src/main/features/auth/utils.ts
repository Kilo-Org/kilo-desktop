import type { UserInfoAttribute } from "./actions.js";

export const USER_SUBSCRIPTIONS = [
	"free_subscription",
	"starter_subscription",
	"business_subscription",
	"commercial_subscription",
	"security_subscription",
	"enterprise_subscription",
	"platform_subscription",
] as const;

export type UserSubscription = (typeof USER_SUBSCRIPTIONS)[number];

export const FREE_SUBSCRIPTION: UserSubscription = USER_SUBSCRIPTIONS[0];

const SUBSCRIPTION_SET = new Set<string>(USER_SUBSCRIPTIONS);

/**
 * Keeps `group === "subscriptions"` attributes, takes the `id` prefix before the
 * first `.` (`"business_subscription.org-id"` → `"business_subscription"`), and
 * drops anything not in {@link USER_SUBSCRIPTIONS}.
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
