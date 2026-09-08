import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import type { ElectronShell } from "../../platform/ElectronShell.js";

export function createShellHandlers(
	electronShell: ElectronShell,
): Pick<
	IpcHandlers,
	"shell:open-external" | "shell:copy-text" | "shell:show-item-in-folder" | "shell:show-open-dialog"
> {
	return {
		"shell:open-external": async ({ url }) => ({
			opened: await electronShell.openExternal(url),
		}),
		"shell:copy-text": ({ text }) => {
			electronShell.copyText(text);
		},
		"shell:show-item-in-folder": async ({ path }) => ({
			revealed: electronShell.showItemInFolder(path),
		}),
		"shell:show-open-dialog": (input) => electronShell.showOpenDialog(input),
	} satisfies Pick<
		IpcHandlers,
		| "shell:open-external"
		| "shell:copy-text"
		| "shell:show-item-in-folder"
		| "shell:show-open-dialog"
	>;
}
