import { EventEmitter } from "node:events";
import {
	createClient,
	type LDClient,
	type LDContext,
	type LDLogger,
} from "@launchdarkly/node-client-sdk";

import { createLogger, type Logger } from "../../platform/logger.js";
import type { FeatureFlagEvents, FeatureFlagContext, FeatureFlagProvider } from "./types.js";

export interface LaunchDarklyProviderOptions {
	clientSideId: string;
	initialContext: FeatureFlagContext;
	logger?: Logger;
}

type FlagMap = Record<string, unknown>;

function toLdContext(ctx: FeatureFlagContext): LDContext {
	return {
		kind: "user",
		key: ctx.userId ?? "anonymous",
		anonymous: !ctx.userId,
		is_anaconda_employee: ctx.isEmployee,
		subscription: ctx.subscription,
	};
}

/**
 * LaunchDarkly-backed provider. `start()` never throws — a non-`complete`
 * initialization is logged and the client degrades to returning defaults.
 */
export class LaunchDarklyProvider
	extends EventEmitter<FeatureFlagEvents>
	implements FeatureFlagProvider
{
	readonly #client: LDClient;
	readonly #logger: Logger;

	constructor(options: LaunchDarklyProviderOptions) {
		super();
		this.#logger = options.logger ?? createLogger("launch-darkly");
		this.#client = createClient(options.clientSideId, toLdContext(options.initialContext), {
			logger: this.#logger as LDLogger,
		});

		this.#client.on("change", () => {
			this.emit("change");
		});
	}

	async start(): Promise<void> {
		try {
			const result = await this.#client.start();
			if (result.status !== "complete") {
				this.#logger.warn(`LaunchDarkly initialization status: ${result.status}`);
			}
		} catch (cause) {
			this.#logger.error("LaunchDarkly failed to start", cause);
		}
	}

	getFlag<T>(key: string, defaultValue?: T): T {
		return this.#client.variation(key, defaultValue) as T;
	}

	getAllFlags(): FlagMap {
		return this.#client.allFlags();
	}

	async identify(context: FeatureFlagContext): Promise<void> {
		await this.#client.identify(toLdContext(context));
	}

	async dispose(): Promise<void> {
		this.removeAllListeners();
		await this.#client.close();
	}
}
