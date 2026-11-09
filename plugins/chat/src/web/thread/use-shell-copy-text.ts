import { KernelClipboard } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";

/**
 * Copies through the host clipboard (`kernel/clipboard`): Electron denies
 * `navigator.clipboard` writes in the renderer. Without the host (the
 * browser), the web clipboard is used.
 */
export function useShellCopyText(): (text: string) => Promise<void> {
	const clipboard = useDomain(KernelClipboard);
	return (text: string) =>
		clipboard
			? clipboard.methods.writeText({ text })
			: globalThis.navigator.clipboard.writeText(text);
}
