import { release } from "node:os";

import { createLogger } from "../../platform/logger.js";
import { HttpClient } from "../../platform/HttpClient.js";
import type {
	TelemetryConfig,
	TelemetryEntry,
	TelemetryLogger,
	TelemetryProvider,
} from "./types.js";

export interface PostHogProviderOptions {
	config: TelemetryConfig;
	logger?: TelemetryLogger;
	/** Injectable for tests; production defaults to Electron `net.fetch`. */
	fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface PostHogEvent {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
	timestamp: string;
}

/**
 * PostHog-backed telemetry provider. Uses the plain `/batch/` capture API over
 * Electron `net.fetch` (per the apps/desktop networking rule) rather than
 * `posthog-node`, which would reach for plain Node `fetch`.
 *
 * Identity follows PostHog's model for backend SDKs, where there is no
 * anonymous session to merge: the lowercased email is the `distinct_id` once a
 * user is known, the installation id carries genuinely anonymous usage, and
 * `$identify` sets person properties on the email person.
 *
 * Deliberately no `$create_alias` to roll pre-login events into the user.
 * PostHog would make the *alias* the surviving id (so the machine UUID, not the
 * email, would become canonical), and it refuses a merge when the alias id was
 * already identified or is associated with more than one distinct id — both of
 * which apply here, since the installation id is shared by every account that
 * signs in on the machine. Merging it would also fuse two real users who share
 * a device. Pre-login events therefore stay on the installation persona.
 *
 * Development builds never talk to PostHog.
 */
export class PostHogProvider implements TelemetryProvider {
	readonly #config: TelemetryConfig;
	readonly #logger: TelemetryLogger;
	readonly #fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	readonly #inFlight = new Set<Promise<void>>();

	/** Last distinct id seen; `$identify` fires once per identity change. */
	#distinctId: string | undefined;

	constructor(options: PostHogProviderOptions) {
		this.#config = options.config;
		this.#logger = options.logger ?? createLogger("telemetry");
		this.#fetch = options.fetch ?? new HttpClient().fetch;
	}

	async track(entry: TelemetryEntry): Promise<void> {
		if (this.#config.environment === "development") {
			this.#logger.debug(`telemetry suppressed in development: '${entry.event}'`);
			return;
		}

		const email = entry.email?.toLowerCase();
		const distinctId = email ?? entry.installationId;
		const previousId = this.#distinctId;
		const identityChanged = previousId !== distinctId;

		const events: PostHogEvent[] = [];
		if (email !== undefined && identityChanged) {
			// Person properties belong to this email, so identify on every switch
			// into it — including account→account, where the new person would
			// otherwise never receive its properties.
			events.push(this.#identifyEvent(entry, email));
		}
		events.push(this.#captureEvent(entry, distinctId));
		this.#distinctId = distinctId;

		await this.#send(events);
	}

	async dispose(): Promise<void> {
		await Promise.allSettled([...this.#inFlight]);
	}

	#captureEvent(entry: TelemetryEntry, distinctId: string): PostHogEvent {
		const properties: Record<string, unknown> = {
			...entry.data,
			installationId: entry.installationId,
			appRunId: entry.appRunId,
			appName: this.#config.serviceId,
			appVersion: this.#config.serviceVersion,
			platform: process.platform,
			os_version: release(),
			os_arch: process.arch,
			environment: this.#config.environment,
			is_anaconda_employee: entry.isEmployee,
		};
		if (entry.cohortId !== undefined) properties.cohortId = entry.cohortId;
		return {
			event: entry.event,
			distinct_id: distinctId,
			properties,
			timestamp: new Date().toISOString(),
		};
	}

	#identifyEvent(entry: TelemetryEntry, email: string): PostHogEvent {
		const set: Record<string, unknown> = {
			email,
			is_anaconda_employee: entry.isEmployee,
		};
		if (entry.cohortId !== undefined) set.cohortId = entry.cohortId;
		return {
			event: "$identify",
			distinct_id: email,
			properties: { $set: set },
			timestamp: new Date().toISOString(),
		};
	}

	async #send(events: PostHogEvent[]): Promise<void> {
		const host = this.#config.posthogHost.replace(/\/+$/, "");
		const sending = (async () => {
			try {
				const response = await this.#fetch(`${host}/batch/`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ api_key: this.#config.posthogKey, batch: events }),
				});
				if (!response.ok) {
					this.#logger.error(`PostHog rejected telemetry batch (HTTP ${response.status})`);
				}
			} catch (cause) {
				this.#logger.error("PostHog failed to send telemetry batch", cause);
			}
		})();
		this.#inFlight.add(sending);
		try {
			await sending;
		} finally {
			this.#inFlight.delete(sending);
		}
	}
}
