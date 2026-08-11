import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

/**
 * Copy via the desktop shell bridge (`sdk.shell.copyText`).
 * Electron denies `navigator.clipboard` (`clipboard-sanitized-write`) in
 * ElectronSecurity; main-process clipboard is the supported path.
 */
export function useShellCopyText(): (text: string) => Promise<void> {
	const sdk = useSdk("kilo-ui");
	return (text: string) => sdk.shell.copyText(text);
}
