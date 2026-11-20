import type EventEmitter from "node:events";

export interface FeatureFlagOrganizationContext {
	/** Stable identifier used as the LaunchDarkly organization context key. */
	id: string;
	name?: string;
	role?: string;
}

/** Another signed-in account (`kernel/linked-account`), as a LaunchDarkly context of its own kind. */
export interface FeatureFlagLinkedAccountContext {
	/** The LaunchDarkly context kind, e.g. `kilo.anaconda` (see `contextFor`). */
	kind: string;
	key: string;
	email?: string;
	organization?: FeatureFlagOrganizationContext;
	attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface FeatureFlagContext {
	userId?: string | undefined;
	isEmployee: boolean;
	subscription?: string;
	email?: string;
	username?: string;
	firstName?: string;
	lastName?: string;
	/** Human-readable full name; falls back to username/email upstream. */
	name?: string;
	/** Primary organization/company for the user, when available. */
	organization?: FeatureFlagOrganizationContext;
	/** Other signed-in accounts, each its own context kind. */
	linkedAccounts?: readonly FeatureFlagLinkedAccountContext[];
}

export interface FeatureFlagEvents {
	change: [];
}

/** Result of a provider `start()`, mirroring LaunchDarkly's initialization statuses. */
export type StartStatus = "complete" | "timeout" | "failed";

/** Swappable feature-flag backend, implemented by `LaunchDarklyProvider`. */
export interface FeatureFlagProvider extends EventEmitter<FeatureFlagEvents> {
	start(): Promise<StartStatus>;
	getAllFlags(): Record<string, unknown>;
	identify(context: FeatureFlagContext): Promise<void>;
	dispose(): Promise<void>;
}
