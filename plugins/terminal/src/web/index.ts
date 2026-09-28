import type { SDK } from "@kilo-desktop/feature-sdk";

import { registerTerminalWebMcpTools } from "./terminal-webmcp-tools.js";

export { TerminalLifecycleProvider } from "./TerminalLifecycleProvider.js";
export { TerminalIcon, TerminalView } from "./TerminalView.js";

export function webRegister(sdk: SDK): void {
	registerTerminalWebMcpTools(sdk);
}
