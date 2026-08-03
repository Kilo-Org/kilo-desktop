import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import type { TelemetryService } from "./service.js";

export function createTelemetryHandlers(
	service: TelemetryService,
): Pick<IpcHandlers, "telemetry:track"> {
	return {
		"telemetry:track": (input) => service.track(input),
	};
}
