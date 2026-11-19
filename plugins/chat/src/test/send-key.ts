import { KernelKeybindings } from "@kilo-desktop/kernel";

import { CHAT_COMMANDS } from "../contracts";
import type { renderChat } from "./render-chat";

/** Chooses Ctrl+Enter as the send key, as Settings → Chat does. */
export async function sendWithCtrlEnter(host: Awaited<ReturnType<typeof renderChat>>) {
	await host.host.main.kernelSdk.domainObjects
		.get(KernelKeybindings)!
		.methods.setOverride({ command: CHAT_COMMANDS.sendMessage, chord: "Ctrl+Enter" });
}
