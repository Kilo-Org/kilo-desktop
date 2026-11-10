import { WorkerPoolContext, useWorkerPool } from "@pierre/diffs/react";
import {
	getOrCreateWorkerPoolSingleton,
	type WorkerInitializationRenderOptions,
	type WorkerPoolOptions,
} from "@pierre/diffs/worker";
import PierreDiffWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useState, type ReactNode } from "react";

import { useDiffTheme } from "./diff-theme";

// The same pool kilo.chat's transcripts use: Pierre keeps one singleton per
// window, so whichever plugin asks first creates it with these options.
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
		void workerPool?.setRenderOptions({ theme }).catch((error: unknown) => {
			console.warn("Could not update syntax highlighting theme.", error);
		});
	}, [theme, workerPool]);
	return null;
}

/**
 * The window's highlighting workers for the Changes pane. Never terminated
 * here: Pierre's own provider ends the pool with its last instance, which
 * would cancel other panes' highlighting whenever a Changes pane closes.
 */
export function DiffWorkerPool({ children }: { children: ReactNode }) {
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
