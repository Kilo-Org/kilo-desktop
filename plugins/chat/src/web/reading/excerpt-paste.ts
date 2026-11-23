import { useEffect, type RefObject } from "react";

import { lengthBucket } from "@kilo-desktop/ui/lib/reading/buckets";
import { matchExcerpt } from "@kilo-desktop/ui/lib/reading/excerpts";

import type { ChatReading } from "./chat-reading";

const COMPOSER_INPUT = '[data-qa-id="kilo-composer-input"]';

/**
 * Notices text copied in Focus being pasted into this pane's composer within
 * a few minutes (matched by hash only) and reports it, content-free.
 */
export function useExcerptPasteTelemetry(
	root: RefObject<HTMLElement | null>,
	reading: ChatReading | undefined,
): void {
	useEffect(() => {
		const element = root.current;
		if (!element || !reading) return;
		const onPaste = (event: ClipboardEvent) => {
			if (!(event.target as Element | null)?.closest?.(COMPOSER_INPUT)) return;
			const text = event.clipboardData?.getData("text/plain") ?? "";
			const match = text ? matchExcerpt(text) : null;
			if (!match) return;
			reading.track("focus-excerpt-used-in-prompt", {
				secondsSinceCopy: match.secondsSinceCopy,
				length: lengthBucket(text.length),
				surface: match.surface,
			});
		};
		element.addEventListener("paste", onPaste, true);
		return () => element.removeEventListener("paste", onPaste, true);
	}, [reading, root]);
}
