import { useEffect, useRef } from "react";

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
	const latest = useRef(options);
	latest.current = options;
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
	}, [reading, workSessionId, paneId]);
	useEffect(() => {
		reading?.focus.changed();
	}, [reading, options.available]);
}
