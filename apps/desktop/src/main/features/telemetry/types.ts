import type {
	AnonymizeOption,
	AuthSession,
	TelemetryEvent,
	TelemetryOptions,
} from "@kilo-desktop/contracts";

import type { Logger } from "../../platform/logger.js";

export type { AnonymizeOption, TelemetryEvent, TelemetryOptions };

export type TelemetryLogger = Pick<Logger, "info" | "warn" | "error" | "debug">;

/** Auth surface the telemetry stack reads, implemented by `AuthSessionService`. */
export interface TelemetryAuth {
	getSession(): Promise<AuthSession>;
}

/**
 * Identity carried by every event. Email is the PostHog `distinct_id` and the
 * only durable user identifier — Anaconda `userId`/`subscription` are omitted
 * because that auth is expected to disappear in favor of Kilo login.
 */
export interface TelemetryIdentity {
	email?: string;
	isEmployee: boolean;
	cohortId?: number;
}

export interface TelemetryEntry {
	event: TelemetryEvent;
	data: Record<string, unknown>;
	installationId: string;
	appRunId: string;
	email?: string;
	isEmployee: boolean;
	cohortId?: number;
}

export interface TelemetryConfig {
	posthogKey: string;
	posthogHost: string;
	/** Release environment: `stable` | `preview` | `development`. */
	environment: string;
	serviceId: string;
	serviceVersion: string;
}

/** Swappable backend; `PostHogProvider` is the production implementation. */
export interface TelemetryProvider {
	track(entry: TelemetryEntry): Promise<void>;
	dispose(): Promise<void>;
}
