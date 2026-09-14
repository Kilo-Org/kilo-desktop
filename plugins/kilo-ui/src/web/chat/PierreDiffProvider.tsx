import {
	WorkerPoolContextProvider,
	useWorkerPool,
	type WorkerInitializationRenderOptions,
	type WorkerPoolOptions,
} from "@pierre/diffs/react";
import PierreDiffWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

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
		// Provider options are initialization-only; update the existing shared pool.
		void workerPool?.setRenderOptions({ theme }).catch((error: unknown) => {
			console.warn("Could not update syntax highlighting theme.", error);
		});
	}, [theme, workerPool]);
	return null;
}

export function PierreDiffProvider({ children }: { children: ReactNode }) {
	const sdk = useSdk("kilo-ui");
	const { shiki } = useSyncExternalStore(sdk.theme.subscribe, sdk.theme.appearance);

	return (
		<WorkerPoolContextProvider
			poolOptions={WORKER_POOL_OPTIONS}
			highlighterOptions={{ ...WORKER_HIGHLIGHTER_OPTIONS, theme: shiki }}
		>
			<SyncWorkerTheme theme={shiki} />
			{children}
		</WorkerPoolContextProvider>
	);
}
