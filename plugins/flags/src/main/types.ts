import type EventEmitter from "node:events";

export interface FeatureFlagOrganizationContext {
	/** Stable identifier used as the LaunchDarkly organization context key. */
	id: string;
	name?: string;
	role?: string;
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
}

export interface FeatureFlagEvents {
	change: [];
}

/** Result of a provider `start()`, mirroring LaunchDarkly's initialization statuses. */
export type StartStatus = "complete" | "timeout" | "failed";

/** Swappable feature-flag backend, implemented by `LaunchDarklyProvider`. */
export interface FeatureFlagProvider extends EventEmitter<FeatureFlagEvents> {
	start(): Promise<StartStatus>;
	getFlag<T>(key: string, defaultValue?: T): T;
	getAllFlags(): Record<string, unknown>;
	identify(context: FeatureFlagContext): Promise<void>;
	dispose(): Promise<void>;
}
