import { z } from "zod";

import { defineDomainObject, method } from "../domain-object";
import { defineExtensionPoint, implementation } from "../extension-point";
import type { IdentityState } from "./identity";

/**
 * An event a plugin may send, by contribution id; `name` is what sinks
 * report (Title Case, the org-wide analytics convention). Events are read
 * from manifests: anything a plugin didn't declare is dropped.
 */
export const KernelTelemetryEvent = defineExtensionPoint({
	id: "kernel/telemetry-event",
	kind: "additive",
	description: "An analytics event the contributing plugin may send.",
	metadata: z.object({ name: z.string().min(1) }),
});

/** One event as delivered to sinks: only declared events, only with consent. */
export interface TelemetryEnvelope {
	/** The declared event's `name`. */
	readonly name: string;
	/** The event's contribution key (`<plugin>/<id>`). */
	readonly key: string;
	readonly pluginId: string;
	readonly data: Readonly<Record<string, unknown>>;
	/** Who the user is when the event is sent. */
	readonly identity: IdentityState;
	/** From `kernel/data-collection`. */
	readonly installationId: string;
	readonly environment: string;
	/** Milliseconds since the epoch. */
	readonly timestamp: number;
}

/** What a sink implements, in main. A sink that throws is logged and skipped. */
export interface TelemetrySink {
	deliver(envelope: TelemetryEnvelope): void | Promise<void>;
}

/** Delivers events, e.g. to an analytics service. Every sink receives every event. */
export const KernelTelemetrySink = defineExtensionPoint({
	id: "kernel/telemetry-sink",
	kind: "additive",
	description: "Delivers telemetry events.",
	implementation: implementation<TelemetrySink>("main"),
});

export const trackInputSchema = z.object({
	/** The id of a `kernel/telemetry-event` the caller declared. */
	event: z.string().min(1),
	data: z.record(z.string(), z.unknown()).default({}),
});
export type TrackInput = z.input<typeof trackInputSchema>;

/**
 * Sends telemetry on behalf of the calling plugin. Nothing is sent without
 * consent (`kernel/data-collection`), events the caller didn't declare are
 * dropped, and tracking never fails the caller.
 */
export const KernelTelemetry = defineDomainObject({
	id: "kernel/telemetry",
	home: "main",
	description: "Sends the analytics events plugins declared.",
	state: z.object({}),
	methods: {
		track: method(trackInputSchema, z.undefined()),
	},
});
