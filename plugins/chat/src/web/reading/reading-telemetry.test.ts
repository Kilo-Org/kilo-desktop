import { describe, expect, it } from "vitest";

import manifest from "../../../plugin.json";
import { READING_EVENT_IDS } from "./reading-telemetry";

describe("Reading Mode telemetry catalog", () => {
	it("declares every event kilo.chat sends, and only those", () => {
		const declared = (manifest.contributes.extensions["kernel/telemetry-event"] ?? []).map(
			(event) => event.id,
		);

		expect([...declared].sort()).toEqual([...READING_EVENT_IDS].sort());
	});
});
