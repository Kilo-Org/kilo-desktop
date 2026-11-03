import { z } from "zod";

import { defineTool, type ToolImplementation } from "@kilo-desktop/plugin-agent/contracts";

/** Origin's model-facing tool, now in main: it asks a main window to open the section. */
export function localInferenceTools(options: {
	readonly openSettings: () => void;
}): Readonly<Record<string, ToolImplementation>> {
	return {
		"settings.open": defineTool({
			description:
				"Open the Local Model Server settings in the desktop app. Use this when the user asks " +
				"to view, configure, or manage their local model server or local model catalog.",
			input: z.object({}).strict(),
			run: () => {
				options.openSettings();
				return { opened: true };
			},
		}),
	};
}
