import { KernelClipboard } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";

/**
 * Copies through the host clipboard (`kernel/clipboard`): Electron denies
 * `navigator.clipboard` writes in the renderer. Without the host (the
 * browser), the web clipboard is used. Stable per clipboard, so it can feed
 * memoized header context.
 */
export function useCopyText(): (text: string) => Promise<void> {
	const clipboard = useDomainObject(KernelClipboard);
	return (text: string) =>
		clipboard
			? clipboard.methods.writeText({ text })
			: globalThis.navigator.clipboard.writeText(text);
}
