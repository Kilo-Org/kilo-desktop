import type { AuthSession, TelemetryTrackInput } from "@kilo-desktop/contracts";

import { createLogger } from "../../platform/logger.js";
import { isAnacondaEmployee } from "../auth/utils.js";
import { PostHogProvider } from "./provider.js";
import { calculatePeriodId, maskEmail } from "./utils.js";
import type {
	AnonymizeOption,
	TelemetryAuth,
	TelemetryEntry,
	TelemetryIdentity,
	TelemetryLogger,
	TelemetryProvider,
} from "./types.js";

/** Preference/config surface the service reads per event. */
export interface TelemetryPreferences {
	readonly allowDataCollection: boolean;
	getInstallationId(): string;
}

export interface CreateTelemetryOptions {
	auth: TelemetryAuth;
	preferences: TelemetryPreferences;
	appVersion: string;
	/** Release environment reported on every event: `stable` | `preview` | `development`. */
	environment: string;
	appRunId?: string;
}

export interface TelemetryServiceOptions {
	provider: TelemetryProvider;
	auth: TelemetryAuth;
	preferences: TelemetryPreferences;
	appVersion: string;
	appRunId?: string;
	logger?: TelemetryLogger;
}

const ANONYMOUS_IDENTITY: TelemetryIdentity = { isEmployee: false };

const POSTHOG_KEY = "phc_GK2Pxl0HPj5ZPfwhLRjXrtdz8eD7e9MKnXiFrOqnB6z";
const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

/** Reads the PostHog host override from `import.meta.env.VITE_POSTHOG_HOST`. */
function posthogHostFromEnv(): string {
	const { VITE_POSTHOG_HOST } = import.meta.env;
	return VITE_POSTHOG_HOST || POSTHOG_DEFAULT_HOST;
}

/**
 * Derives telemetry identity from the auth session. `anonymize: "always"`, an
 * anonymous/error session, a session without an email, or any read failure
 * yields the anonymous identity; never throws.
 */
export async function deriveTelemetryIdentity(
	auth: TelemetryAuth,
	anonymize: AnonymizeOption,
): Promise<TelemetryIdentity> {
	// NOTE: "if-not-logged-in" currently behaves identically to "never"; it will
	// diverge when we implement not establishing/refreshing a session for it.
	if (anonymize === "always") return ANONYMOUS_IDENTITY;

	let session: AuthSession;
	try {
		session = await auth.getSession();
	} catch {
		return ANONYMOUS_IDENTITY;
	}
	if (session.status !== "authenticated") return ANONYMOUS_IDENTITY;

	const email = session.user.email;
	if (email === undefined || email === "") return ANONYMOUS_IDENTITY;

	return {
		email,
		isEmployee: isAnacondaEmployee(email),
		cohortId: calculatePeriodId(),
	};
}

/**
 * Provider-agnostic telemetry service. Gates on `allowDataCollection`, resolves
 * identity from the auth session, assembles a {@link TelemetryEntry}, and hands
 * it to the provider. All failures are swallowed + logged so telemetry never
 * breaks a caller.
 */
export class TelemetryService {
	readonly #provider: TelemetryProvider;
	readonly #auth: TelemetryAuth;
	readonly #preferences: TelemetryPreferences;
	readonly #logger: TelemetryLogger;
	readonly #appVersion: string;
	readonly #appRunId: string;

	constructor(options: TelemetryServiceOptions) {
		this.#provider = options.provider;
		this.#auth = options.auth;
		this.#preferences = options.preferences;
		this.#logger = options.logger ?? createLogger("telemetry");
		this.#appVersion = options.appVersion;
		this.#appRunId = options.appRunId ?? crypto.randomUUID();
	}

	/** Assemble the telemetry stack: auth → PostHog provider → service. */
	static create(options: CreateTelemetryOptions): TelemetryService {
		const provider = new PostHogProvider({
			config: {
				posthogKey: POSTHOG_KEY,
				posthogHost: posthogHostFromEnv(),
				environment: options.environment,
				serviceId: "kilo-desktop",
				serviceVersion: options.appVersion,
			},
		});
		return new TelemetryService({
			provider,
			auth: options.auth,
			preferences: options.preferences,
			appVersion: options.appVersion,
			...(options.appRunId !== undefined ? { appRunId: options.appRunId } : {}),
		});
	}

	async initialize(): Promise<void> {
		await this.track({
			event: "Desktop Initialized",
			data: {
				timestamp: Date.now(),
				version: this.#appVersion,
				platform: process.platform,
			},
		});
	}

	async track(input: TelemetryTrackInput): Promise<void> {
		try {
			if (!this.#preferences.allowDataCollection) return;

			const anonymize: AnonymizeOption = input.options?.anonymize ?? "never";
			const identity = await deriveTelemetryIdentity(this.#auth, anonymize);

			// Debug-level, sanitized: the identity a track() call resolves to.
			// Visible with KILO_LOG_LEVEL=debug.
			this.#logger.debug(
				`telemetry derive event='${input.event}' anonymize=${anonymize} ` +
					`email=${maskEmail(identity.email)} isEmployee=${identity.isEmployee} cohort=${identity.cohortId ?? "none"}`,
			);

			const entry: TelemetryEntry = {
				...identity,
				event: input.event,
				data: input.data,
				installationId: this.#preferences.getInstallationId(),
				appRunId: this.#appRunId,
			};

			await this.#provider.track(entry);
		} catch (cause) {
			this.#logger.error(`Failed to send telemetry event '${input.event}'`, cause);
		}
	}

	async dispose(): Promise<void> {
		await this.#provider.dispose();
	}
}
