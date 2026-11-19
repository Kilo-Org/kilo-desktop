import { describe, expect, it } from "vitest";

import manifest from "../../../plugin.json";
import { CHAT_TELEMETRY_EVENTS } from "../../contracts";
import { READING_EVENT_IDS } from "./reading-telemetry";

describe("Reading Mode telemetry catalog", () => {
	it("declares every Reading Mode event in the manifest and the contracts", () => {
		const declared = (manifest.contributes.extensions["kernel/telemetry-event"] ?? []).map(
			(event) => event.id,
		);

		expect(declared).toEqual(expect.arrayContaining([...READING_EVENT_IDS]));
		expect(Object.values(CHAT_TELEMETRY_EVENTS)).toEqual(
			expect.arrayContaining([...READING_EVENT_IDS]),
		);
	});
});
