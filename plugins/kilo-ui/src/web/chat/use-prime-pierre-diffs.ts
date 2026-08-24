import type { FileDiffMetadata } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect } from "react";

export function usePrimePierreDiffs(fileDiffs: readonly FileDiffMetadata[]): void {
	const workerPool = useWorkerPool();

	useEffect(() => {
		if (!workerPool) return;
		for (const fileDiff of fileDiffs) {
			workerPool.primeDiffHighlightCache(fileDiff);
		}
	}, [fileDiffs, workerPool]);
}
