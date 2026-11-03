import { WorkerPoolContext, useWorkerPool } from "@pierre/diffs/react";
import {
	getOrCreateWorkerPoolSingleton,
	type WorkerInitializationRenderOptions,
	type WorkerPoolOptions,
} from "@pierre/diffs/worker";
import PierreDiffWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useState, type ReactNode } from "react";

import { useDiffTheme } from "./diff-theme";

const WORKER_POOL_OPTIONS = {
	poolSize: 2,
	totalASTLRUCacheSize: 120,
	workerFactory: () => new PierreDiffWorker(),
} satisfies WorkerPoolOptions;

const WORKER_HIGHLIGHTER_OPTIONS = {
	langs: ["text"],
	preferredHighlighter: "shiki-js",
	tokenizeMaxLineLength: 1_000,
} satisfies WorkerInitializationRenderOptions;

function SyncWorkerTheme({ theme }: { theme: string }) {
	const workerPool = useWorkerPool();
	useEffect(() => {
		// Pool options are initialization-only; update the existing shared pool.
		void workerPool?.setRenderOptions({ theme }).catch((error: unknown) => {
			console.warn("Could not update syntax highlighting theme.", error);
		});
	}, [theme, workerPool]);
	return null;
}

/**
 * The highlighting workers every transcript in the window shares, following
 * the window's theme. The pool lives as long as the window: Pierre's own
 * provider terminates it when its last instance unmounts, which would cancel
 * other panes' in-flight highlighting each time an agent pane closes.
 */
export function PierreDiffProvider({ children }: { children: ReactNode }) {
	const { shiki } = useDiffTheme();
	const [pool] = useState(() =>
		getOrCreateWorkerPoolSingleton({
			poolOptions: WORKER_POOL_OPTIONS,
			highlighterOptions: { ...WORKER_HIGHLIGHTER_OPTIONS, theme: shiki },
		}),
	);
	return (
		<WorkerPoolContext.Provider value={pool}>
			<SyncWorkerTheme theme={shiki} />
			{children}
		</WorkerPoolContext.Provider>
	);
}
