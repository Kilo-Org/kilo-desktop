import { z } from "zod";

import { defineTool, type ToolImplementation } from "@kilo-desktop/plugin-core/contracts";

import { OPEN_SETTINGS_TOOL } from "../contracts";

/** Origin's model-facing tool, in main: it opens the section in a window. */
export function localInferenceTools(options: {
	readonly openSettings: () => Promise<void>;
}): Readonly<Record<string, ToolImplementation>> {
	return {
		[OPEN_SETTINGS_TOOL]: defineTool({
			description:
				"Open the Local Model Server settings in the desktop app. Use this when the user asks " +
				"to view, configure, or manage their local model server or local model catalog.",
			input: z.object({}).strict(),
			run: async () => {
				await options.openSettings();
				return { opened: true };
			},
		}),
	};
}
