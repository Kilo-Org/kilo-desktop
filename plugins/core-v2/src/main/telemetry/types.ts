import type { KernelLogger } from "@kilo-desktop/kernel";

export type TelemetryLogger = KernelLogger;

/**
 * One event for the provider. Email (the PostHog `distinct_id` once a user is
 * known), employee flag and cohort come from the primary account of
 * `kernel/identity`; without one every event is anonymous.
 */
export interface TelemetryEntry {
	event: string;
	data: Record<string, unknown>;
	installationId: string;
	appRunId: string;
	/** Release environment: `stable` | `preview` | `development`; development never sends. */
	environment: string;
	email?: string;
	isEmployee: boolean;
	cohortId?: number;
}

export interface TelemetryConfig {
	posthogKey: string;
	posthogHost: string;
	serviceId: string;
	serviceVersion: string;
}

/** Swappable backend; `PostHogProvider` is the production implementation. */
export interface TelemetryProvider {
	track(entry: TelemetryEntry): Promise<void>;
	dispose(): Promise<void>;
}
