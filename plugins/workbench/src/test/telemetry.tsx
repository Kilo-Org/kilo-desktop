import { vi } from "vitest";

import type { PluginSdk } from "@kilo-desktop/kernel";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import {
	Telemetry,
	TELEMETRY_DEFINITIONS,
	TelemetryEvent,
} from "@kilo-desktop/plugin-telemetry/contracts";

/**
 * kilo.telemetry's domain, recording the events a plugin sends. Like the real
 * one, it drops events the caller doesn't declare.
 */
export function fakeTelemetry() {
	const tracked = vi.fn<(event: string, data: Record<string, unknown>) => void>();
	return {
		tracked,
		plugin: {
			manifest: telemetryManifest,
			definitions: TELEMETRY_DEFINITIONS,
			main: {
				activate(sdk: PluginSdk) {
					const declares = (pluginId: string, event: string) =>
						sdk.extensions
							.list(TelemetryEvent)
							.some(
								(contribution) =>
									contribution.pluginId === pluginId && contribution.metadata.name === event,
							);
					sdk.domains.provide(Telemetry, {
						initialState: {},
						methods: {
							track: ({ event, data }, caller) => {
								if (declares(caller.pluginId, event)) tracked(event, data ?? {});
							},
						},
					});
				},
			},
		},
	};
}
