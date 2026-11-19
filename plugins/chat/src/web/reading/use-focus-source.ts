import { useEffect, useRef } from "react";

import type { ChatFocusTarget, FocusSource } from "./chat-focus";
import { useChatReading } from "./chat-reading";

interface FocusSourceOptions {
	readonly kind: ChatFocusTarget["kind"];
	readonly available: boolean;
	readonly targetNearMiddle: () => ChatFocusTarget | null;
	readonly reveal: (target: ChatFocusTarget) => void;
}

/** Registers the pane as something Focus can read while it is mounted. */
export function useFocusSource(options: FocusSourceOptions): void {
	const context = useChatReading();
	const latest = useRef(options);
	latest.current = options;
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
		};
		return reading.focus.register(source);
	}, [reading, workSessionId, paneId]);
	useEffect(() => {
		reading?.focus.changed();
	}, [reading, options.available]);
}
