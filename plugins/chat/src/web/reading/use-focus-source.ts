import { useEffect, useRef } from "react";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import type { FocusEntryContext } from "@kilo-desktop/ui/lib/reading/focus-controller";

import type { ChatFocusTarget, FocusSource } from "./chat-focus";
import { useChatReading } from "./chat-reading";

interface FocusSourceOptions {
	readonly kind: ChatFocusTarget["kind"];
	readonly available: boolean;
	readonly targetNearMiddle: () => ChatFocusTarget | null;
	readonly reveal: (target: ChatFocusTarget) => void;
	readonly entryContext: (target: ChatFocusTarget) => FocusEntryContext;
}

/** Registers the pane as something Focus can read while it is mounted. */
export function useFocusSource(options: FocusSourceOptions): void {
	const context = useChatReading();
	const latest = useLatestRef(options);
	const { available } = options;
	const reading = context?.reading;
	const workSessionId = context?.workSessionId;
	const paneId = context?.paneId;
	useEffect(() => {
		if (!reading || !workSessionId || !paneId) return;
		const source: FocusSource = {
			workSessionId,
			paneId,
			kind: latest.current.kind,
			available: () => latest.current.available,
			targetNearMiddle: () => latest.current.targetNearMiddle(),
			reveal: (target) => latest.current.reveal(target),
			entryContext: (target) => latest.current.entryContext(target),
		};
		return reading.focus.register(source);
	}, [latest, reading, workSessionId, paneId]);
	// Focus re-checks its sources when what one offers changes (a first reply arrives).
	const announced = useRef(available);
	useEffect(() => {
		if (announced.current === available) return;
		announced.current = available;
		reading?.focus.changed();
	});
}
