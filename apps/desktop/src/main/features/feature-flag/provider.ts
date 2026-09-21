import { EventEmitter } from "node:events";
import {
	createClient,
	type LDClient,
	type LDContext,
	type LDContextCommon,
	type LDLogger,
} from "@launchdarkly/node-client-sdk";

import { createLogger, type Logger } from "../../platform/logger.js";
import type {
	FeatureFlagEvents,
	FeatureFlagContext,
	FeatureFlagOrganizationContext,
	FeatureFlagProvider,
	StartStatus,
} from "./types.js";

export interface LaunchDarklyProviderOptions {
	clientSideId: string;
	initialContext: FeatureFlagContext;
	appVersion: string;
	/**
	 * Directory for the SDK's on-disk flag cache. Without it the SDK writes
	 * `ldclient-user-cache/` under `process.cwd()`, which is `/` for a packaged
	 * app launched from Finder — the cache then fails with ENOENT on every read.
	 */
	storagePath?: string;
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
			...(options.storagePath !== undefined ? { localStoragePath: options.storagePath } : {}),
		});

		this.#client.on("change", () => {
			this.emit("change");
		});
	}

	/**
	 * Projects the internal context onto a LaunchDarkly context. When the user
	 * belongs to an organization we emit a multi-context — one `user` and one
	 * `organization` kind — so flag rules can target either dimension
	 * independently (per LaunchDarkly's contexts model). Without an org we
	 * emit a single-kind user context.
	 */
	#toLdContext(ctx: FeatureFlagContext): LDContext {
		const user = this.#toUserContext(ctx);

		if (!ctx.organization) {
			return { kind: "user", ...user };
		}

		return {
			kind: "multi",
			user,
			organization: this.#toOrganizationContext(ctx.organization),
		};
	}

	#toUserContext(ctx: FeatureFlagContext): LDContextCommon {
		// LaunchDarkly's built-in user attributes (`name`, `email`, `firstName`,
		// `lastName`) match its documented segment builder; the rest are custom.
		return {
			key: ctx.userId ?? "anonymous",
			anonymous: !ctx.userId,
			...(ctx.name !== undefined ? { name: ctx.name } : {}),
			...(ctx.firstName !== undefined ? { firstName: ctx.firstName } : {}),
			...(ctx.lastName !== undefined ? { lastName: ctx.lastName } : {}),
			...(ctx.email !== undefined ? { email: ctx.email } : {}),
			...(ctx.username !== undefined ? { username: ctx.username } : {}),
			is_anaconda_employee: ctx.isEmployee,
			...(ctx.subscription !== undefined ? { subscription: ctx.subscription } : {}),
			app_version: this.#appVersion,
		};
	}

	#toOrganizationContext(org: FeatureFlagOrganizationContext): LDContextCommon {
		return {
			key: org.id,
			...(org.name !== undefined ? { name: org.name } : {}),
			...(org.role !== undefined ? { role: org.role } : {}),
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
		this.#logger.info(`LaunchDarkly identify: ${describeContext(context)}`);
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

/**
 * Human-readable one-liner for identify logging. Email is masked so the log
 * confirms it was included without persisting the address to log files.
 */
function describeContext(ctx: FeatureFlagContext): string {
	const parts: string[] = [`userId=${ctx.userId ?? "anonymous"}`, `employee=${ctx.isEmployee}`];
	if (ctx.subscription) parts.push(`subscription=${ctx.subscription}`);
	if (ctx.email) parts.push(`email=${maskEmail(ctx.email)}`);
	if (ctx.username) parts.push(`username=${ctx.username}`);
	if (ctx.name) parts.push(`name="${ctx.name}"`);
	if (ctx.organization) {
		parts.push(
			`org=${ctx.organization.id}${ctx.organization.name ? ` (${ctx.organization.name})` : ""}`,
		);
	}
	return parts.join(" ");
}

function maskEmail(email: string): string {
	const [local, domain] = email.split("@");
	if (!local || !domain) return "***";
	const head = local.slice(0, 1);
	return `${head}***@${domain}`;
}
