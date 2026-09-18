import type {
	AnonymizeOption,
	AuthSession,
	TelemetryEvent,
	TelemetryOptions,
} from "@kilo-desktop/contracts";

import type { UserInfoAttribute } from "../auth/actions.js";
import type { Logger } from "../../platform/logger.js";

export type { AnonymizeOption, TelemetryEvent, TelemetryOptions };

export type TelemetryLogger = Pick<Logger, "info" | "warn" | "error" | "debug">;

/** Auth surface the telemetry stack reads, implemented by `AuthSessionService`. */
export interface TelemetryAuth {
	getSession(): Promise<AuthSession>;
	getApiKey(): Promise<string | null>;
	getUserInfo(): Promise<UserInfoAttribute[]>;
	onChanged(listener: () => void): () => void;
}

/** Auth surface the provider needs to select the endpoint and re-init on change. */
export type TelemetryProviderAuth = Pick<TelemetryAuth, "getApiKey" | "onChanged">;

export interface TelemetryIdentity {
	userId?: string;
	isEmployee: boolean;
	cohortId?: number;
	subscription?: string;
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
	track(entry: TelemetryEntry): Promise<void>;
	dispose(): Promise<void>;
}
