import { EventEmitter } from "node:events";
import {
	createClient,
	type LDClient,
	type LDContext,
	type LDLogger,
} from "@launchdarkly/node-client-sdk";

import { createLogger, type Logger } from "../../platform/logger.js";
import type {
	FeatureFlagEvents,
	FeatureFlagContext,
	FeatureFlagProvider,
	StartStatus,
} from "./types.js";

export interface LaunchDarklyProviderOptions {
	clientSideId: string;
	initialContext: FeatureFlagContext;
	appVersion: string;
	logger?: Logger;
}

type FlagMap = Record<string, unknown>;

/** Seconds to wait for the first flag payload before `start()` resolves. */
const START_TIMEOUT_SECONDS = 5;

/**
 * LaunchDarkly-backed provider. Initialization never throws and is never
 * surfaced to users: on failure the client returns defaults while the SDK's
 * streaming source reconnects on its own (including after going offline).
 */
export class LaunchDarklyProvider
	extends EventEmitter<FeatureFlagEvents>
	implements FeatureFlagProvider
{
	readonly #client: LDClient;
	readonly #logger: Logger;
	/** Process-static app version stamped onto every LD context as `app_version`. */
	readonly #appVersion: string;
	/** Shared result of the single `start()`; the client is a start-once singleton. */
	#start: Promise<StartStatus> | undefined;

	constructor(options: LaunchDarklyProviderOptions) {
		super();
		this.#logger = options.logger ?? createLogger("launch-darkly");
		this.#appVersion = options.appVersion;
		this.#client = createClient(options.clientSideId, this.#toLdContext(options.initialContext), {
			logger: this.#logger as LDLogger,
		});

		this.#client.on("change", () => {
			this.emit("change");
		});
	}

	#toLdContext(ctx: FeatureFlagContext): LDContext {
		return {
			kind: "user",
			key: ctx.userId ?? "anonymous",
			anonymous: !ctx.userId,
			is_anaconda_employee: ctx.isEmployee,
			subscription: ctx.subscription,
			app_version: this.#appVersion,
		};
	}

	async start(): Promise<StartStatus> {
		this.#start ??= this.#startOnce();
		return this.#start;
	}

	async #startOnce(): Promise<StartStatus> {
		try {
			const result = await this.#client.start({ timeout: START_TIMEOUT_SECONDS });
			if (result.status === "failed") {
				this.#logger.error("LaunchDarkly initialization failed", result.error);
			} else if (result.status === "timeout") {
				this.#logger.warn(
					`LaunchDarkly did not initialize within ${START_TIMEOUT_SECONDS}s; using defaults until flags stream in.`,
				);
			}
			return result.status;
		} catch (cause) {
			this.#logger.error("LaunchDarkly failed to start", cause);
			return "failed";
		}
	}

	getFlag<T>(key: string, defaultValue?: T): T {
		return this.#client.variation(key, defaultValue) as T;
	}

	getAllFlags(): FlagMap {
		return this.#client.allFlags();
	}

	async identify(context: FeatureFlagContext): Promise<void> {
		// identify() sets the active context immediately (before flags load), so
		// swallowing a slow/offline failure still leaves the derived context in
		// place for the SDK to evaluate once it reconnects. start() must run first.
		await this.start();
		try {
			await this.#client.identify(this.#toLdContext(context));
		} catch (cause) {
			this.#logger.warn(
				"LaunchDarkly identify did not complete; will apply once connected.",
				cause,
			);
		}
	}

	async dispose(): Promise<void> {
		this.removeAllListeners();
		await this.#client.close();
	}
}
