import { z } from "zod";

import {
	defineDomain,
	defineExtensionPoint,
	method,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";

/**
 * kilo.telemetry's public surface. A plugin declares each event it sends as a
 * `telemetry-event` contribution (Title Case `name`, the org-wide PostHog
 * convention) and sends it with `Telemetry.track`. Undeclared events and
 * events without consent are dropped; tracking never fails the caller.
 */
export const TELEMETRY_PLUGIN_ID = "kilo.telemetry";

/** An analytics event the contributing plugin may send. */
export const TelemetryEvent = defineExtensionPoint({
	id: "kilo.telemetry/telemetry-event",
	kind: "additive",
	description: "An analytics event a plugin may send.",
	metadata: z.object({ name: z.string().min(1) }),
});

export const trackInput = z.object({
	event: z.string(),
	data: z.record(z.string(), z.unknown()).default({}),
});
export type TrackInput = z.input<typeof trackInput>;

/** Sends analytics events on behalf of the calling plugin. */
export const Telemetry = defineDomain({
	id: "kilo.telemetry/telemetry",
	home: "main",
	state: z.object({}),
	methods: {
		track: method(trackInput, z.undefined()),
	},
});

export const TELEMETRY_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [TelemetryEvent],
	domains: [Telemetry],
};
