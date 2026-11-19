import { useEffect, useRef } from "react";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import type { FocusSource } from "@kilo-desktop/ui/lib/reading/focus-controller";

import { useFilesReading, type FileFocusTarget } from "./files-reading.js";

interface Options {
	readonly available: boolean;
	readonly targetNearMiddle: () => FileFocusTarget | null;
	readonly reveal: (target: FileFocusTarget) => void;
}

/** Registers the pane's rendered Markdown as something Focus can read while it is mounted. */
export function useFocusSourceRegistration(options: Options): void {
	const context = useFilesReading();
	const latest = useLatestRef(options);
	const { available } = options;
	const reading = context?.reading;
	const workSessionId = context?.workSessionId;
	const paneId = context?.paneId;
	useEffect(() => {
		if (!reading || !workSessionId || !paneId) return;
		const source: FocusSource<FileFocusTarget> = {
			workSessionId,
			paneId,
			kind: "file",
			available: () => latest.current.available,
			targetNearMiddle: () => latest.current.targetNearMiddle(),
			reveal: (target) => latest.current.reveal(target),
		};
		return reading.focus.register(source);
	}, [latest, reading, workSessionId, paneId]);
	// Focus re-checks its sources when what one offers changes (text arrives).
	const announced = useRef(available);
	useEffect(() => {
		if (announced.current === available) return;
		announced.current = available;
		reading?.focus.changed();
	});
}
