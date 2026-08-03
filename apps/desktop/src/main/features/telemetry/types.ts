import type {
	AnonymizeOption,
	TelemetryEvent,
	TelemetryOptions,
} from "@anaconda-agentic-desktop/contracts";

import type { Logger } from "../../platform/logger.js";

export type { AnonymizeOption, TelemetryEvent, TelemetryOptions };

export type TelemetryLogger = Pick<Logger, "info" | "warn" | "error" | "debug">;

export interface TelemetryIdentity {
	userId?: string;
	isEmployee: boolean;
	cohortId?: number;
	subscription?: string;
}

export interface TelemetryAuthAdapter {
	getIdentity(anonymize: AnonymizeOption): Promise<TelemetryIdentity>;
	getApiKey(): Promise<string | null>;
	onChanged(listener: () => void): () => void;
}

export interface TelemetryEntry {
	event: TelemetryEvent;
	data: Record<string, unknown>;
	installationId: string;
	userId?: string;
	isEmployee: boolean;
	cohortId?: number;
	subscription?: string;
}

export interface TelemetryConfig {
	authUrl?: string;
	nonAuthUrl?: string;
	exportIntervalMs?: number;
	environmentAttribute?: string;
	serviceId: string;
	serviceVersion: string;
}

/** Swappable backend; `AnacondaOtelProvider` is the sole importer of `anaconda-opentelemetry`. */
export interface TelemetryProvider {
	send(entry: TelemetryEntry): Promise<void>;
	dispose(): Promise<void>;
}
