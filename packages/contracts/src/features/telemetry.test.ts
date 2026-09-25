import { describe, expect, it } from "vitest";

import { TELEMETRY_EVENTS, telemetryMethods, telemetryTrackInputSchema } from "./telemetry.js";

describe("telemetry contract", () => {
	it("parses a minimal track input", () => {
		const parsed = telemetryTrackInputSchema.parse({
			event: "Desktop Initialized",
			data: { version: "1.2.3" },
		});

		expect(parsed).toEqual({ event: "Desktop Initialized", data: { version: "1.2.3" } });
	});

	it("parses an input carrying anonymize options", () => {
		const parsed = telemetryTrackInputSchema.parse({
			event: "Logged In",
			data: { email_domain: "anaconda.com" },
			options: { anonymize: "always" },
		});

		expect(parsed.options).toEqual({ anonymize: "always" });
	});

	it("rejects an unknown event name", () => {
		expect(
			telemetryTrackInputSchema.safeParse({ event: "NOT_A_REAL_EVENT", data: {} }).success,
		).toBe(false);
	});

	it("rejects legacy snake_case event names", () => {
		expect(
			telemetryTrackInputSchema.safeParse({ event: "DESKTOP_INITIALIZED", data: {} }).success,
		).toBe(false);
	});

	it("rejects an unknown anonymize option", () => {
		expect(
			telemetryTrackInputSchema.safeParse({
				event: "Page Visit",
				data: {},
				options: { anonymize: "sometimes" },
			}).success,
		).toBe(false);
	});

	it("exposes exactly one method channel", () => {
		expect(Object.keys(telemetryMethods)).toEqual(["telemetry:track"]);
	});

	it("keeps the event enum in sync with the const tuple", () => {
		expect(
			telemetryTrackInputSchema.safeParse({ event: TELEMETRY_EVENTS[0], data: {} }).success,
		).toBe(true);
	});
});
