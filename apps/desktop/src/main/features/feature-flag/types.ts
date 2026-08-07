import type EventEmitter from "node:events";

export interface FeatureFlagContext {
	userId?: string | undefined;
	isEmployee: boolean;
	subscription?: string;
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
