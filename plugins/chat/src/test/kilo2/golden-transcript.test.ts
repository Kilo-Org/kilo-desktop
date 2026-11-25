import { applyTranscriptEvents, type KiloEventFrame } from "@kilo-desktop/react-opencode";
import { describe, expect, it } from "vitest";

import { GOLDEN_TURN } from "./golden";

describe("the recorded kilo2 turn, streamed", () => {
	it("folds into the same transcript message.list serves", () => {
		const streamed = applyTranscriptEvents([], GOLDEN_TURN.events as readonly KiloEventFrame[]);

		expect(streamed).toEqual(GOLDEN_TURN.messages);
	});
});
