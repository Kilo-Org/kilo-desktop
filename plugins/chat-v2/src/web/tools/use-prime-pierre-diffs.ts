import type { FileDiffMetadata } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect } from "react";

export function usePrimePierreDiffs(fileDiffs: readonly FileDiffMetadata[]): void {
	const workerPool = useWorkerPool();

	useEffect(() => {
		if (!workerPool) return;
		for (const fileDiff of fileDiffs) {
			// A warm-up only: when the workers can't start, diffs highlight when shown.
			void workerPool.primeDiffHighlightCache(fileDiff).catch(() => undefined);
		}
	}, [fileDiffs, workerPool]);
}
