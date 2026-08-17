import { describe, expect, it, vi } from "vitest";

import type { TelemetryTrackInput } from "@anaconda-agentic-desktop/contracts";

import { createTelemetryHandlers } from "./handlers.js";
import type { TelemetryService } from "./service.js";

describe("createTelemetryHandlers", () => {
	it("forwards the parsed input to service.track", async () => {
		const track = vi.fn(async () => {});
		const handlers = createTelemetryHandlers({ track } as unknown as TelemetryService);

		const input: TelemetryTrackInput = {
			event: "PAGE_VISIT",
			data: { path: "/" },
			options: { anonymize: "never" },
		};
		await handlers["telemetry:track"](input);

		expect(track).toHaveBeenCalledWith(input);
	});
});
