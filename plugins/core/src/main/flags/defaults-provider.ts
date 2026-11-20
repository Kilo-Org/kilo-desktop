import { EventEmitter } from "node:events";

import type { FeatureFlagEvents, FeatureFlagProvider, StartStatus } from "./types";

/**
 * The provider when no LaunchDarkly client-side ID is configured: every flag
 * reads as its default, so kilo.flags still activates (LaunchDarkly's client
 * throws without an ID).
 */
export class DefaultsOnlyProvider
	extends EventEmitter<FeatureFlagEvents>
	implements FeatureFlagProvider
{
	async start(): Promise<StartStatus> {
		return "complete";
	}

	getAllFlags(): Record<string, unknown> {
		return {};
	}

	async identify(): Promise<void> {}

	async dispose(): Promise<void> {}
}
