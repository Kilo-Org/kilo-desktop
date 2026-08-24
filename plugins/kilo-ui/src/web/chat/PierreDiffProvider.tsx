import { preloadHighlighter } from "@pierre/diffs";
import {
	WorkerPoolContextProvider,
	type WorkerInitializationRenderOptions,
	type WorkerPoolOptions,
} from "@pierre/diffs/react";
import PierreDiffWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, type ReactNode } from "react";

import { PIERRE_DIFF_THEME } from "./pierre-diff.js";

const WORKER_POOL_OPTIONS = {
	poolSize: 2,
	totalASTLRUCacheSize: 120,
	workerFactory: () => new PierreDiffWorker(),
} satisfies WorkerPoolOptions;

const WORKER_HIGHLIGHTER_OPTIONS = {
	langs: ["text"],
	theme: PIERRE_DIFF_THEME,
	preferredHighlighter: "shiki-js",
	tokenizeMaxLineLength: 1_000,
} satisfies WorkerInitializationRenderOptions;

const preloadChatDiffHighlighter = () =>
	preloadHighlighter({
		themes: [PIERRE_DIFF_THEME.dark, PIERRE_DIFF_THEME.light],
		langs: ["text"],
		preferredHighlighter: "shiki-js",
	});

export function PierreDiffProvider({ children }: { children: ReactNode }) {
	useEffect(() => {
		void preloadChatDiffHighlighter().catch((error: unknown) => {
			console.warn("Could not preload chat diff highlighting.", error);
		});
	}, []);

	return (
		<WorkerPoolContextProvider
			poolOptions={WORKER_POOL_OPTIONS}
			highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
		>
			{children}
		</WorkerPoolContextProvider>
	);
}
