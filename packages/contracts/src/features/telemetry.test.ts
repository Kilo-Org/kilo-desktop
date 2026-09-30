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

	it("accepts every approved product usage event", () => {
		for (const event of [
			"Marketplace Tab Viewed",
			"Marketplace Install Button Clicked",
			"Marketplace Item Installed",
			"Marketplace Item Removed",
			"Onboarding Shown",
			"Onboarding Completed",
			"Onboarding Skipped",
			"Workspace Created",
			"Workspace Removed",
			"Pane Opened",
			"Pane Closed",
			"Layout Arrangement Changed",
			"Layout Preset Saved",
			"Layout Preset Applied",
			"Layout Preset Removed",
			"Layout Preset Default Changed",
			"Commit Message Generated",
			"Pull Request Content Generated",
			"Environment Created",
			"Environment Removed",
			"Local Model Installed",
			"Local Model Server Started",
			"Local Model Server Stopped",
			"File Opened",
			"Notebook Opened",
			"Browser Tab Opened",
		]) {
			expect(telemetryTrackInputSchema.safeParse({ event, data: {} }).success).toBe(true);
		}
	});
});
