import type { IpcHandlers } from "$shared";

import type { ElectronShell } from "../../platform/ElectronShell.js";

export function createShellHandlers(
	electronShell: ElectronShell,
): Pick<IpcHandlers, "shell:open-external" | "shell:copy-text"> {
	return {
		"shell:open-external": async ({ url }) => ({
			opened: await electronShell.openExternal(url),
		}),
		"shell:copy-text": ({ text }) => {
			electronShell.copyText(text);
		},
	} satisfies Pick<IpcHandlers, "shell:open-external" | "shell:copy-text">;
}
