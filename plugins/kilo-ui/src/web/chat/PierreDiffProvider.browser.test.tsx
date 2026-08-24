import { cleanup, render, waitFor } from "@testing-library/react";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type * as PierreDiffsModule from "@pierre/diffs";
import type * as PierreDiffsReactModule from "@pierre/diffs/react";

const mocks = vi.hoisted(() => ({
	preloadHighlighter: vi.fn(() => Promise.resolve()),
	primeDiffHighlightCache: vi.fn(),
	providerProps: undefined as
		| {
				poolOptions: {
					poolSize?: number;
					totalASTLRUCacheSize?: number;
					workerFactory: () => Worker;
				};
				highlighterOptions: {
					langs?: readonly string[];
					theme?: unknown;
				};
		  }
		| undefined,
}));

vi.mock("@pierre/diffs", async (importOriginal) => ({
	...(await importOriginal<typeof PierreDiffsModule>()),
	preloadHighlighter: mocks.preloadHighlighter,
}));

vi.mock("@pierre/diffs/react", async (importOriginal) => ({
	...(await importOriginal<typeof PierreDiffsReactModule>()),
	WorkerPoolContextProvider: ({
		children,
		poolOptions,
		highlighterOptions,
	}: {
		children: ReactNode;
		poolOptions: NonNullable<typeof mocks.providerProps>["poolOptions"];
		highlighterOptions: NonNullable<typeof mocks.providerProps>["highlighterOptions"];
	}) => {
		mocks.providerProps = { poolOptions, highlighterOptions };
		return children;
	},
	useWorkerPool: () => ({
		primeDiffHighlightCache: mocks.primeDiffHighlightCache,
	}),
}));

vi.mock("@pierre/diffs/worker/worker.js?worker", () => ({
	default: class MockPierreDiffWorker {},
}));

import { PierreDiffProvider } from "./PierreDiffProvider.js";
import { usePrimePierreDiffs } from "./use-prime-pierre-diffs.js";

function PrimeDiff({ fileDiff }: { fileDiff: FileDiffMetadata }) {
	usePrimePierreDiffs([fileDiff]);
	return null;
}

afterEach(() => {
	cleanup();
	mocks.preloadHighlighter.mockClear();
	mocks.primeDiffHighlightCache.mockClear();
	mocks.providerProps = undefined;
});

describe("PierreDiffProvider", () => {
	it("prewarms highlighting once and primes collapsed diff metadata", async () => {
		const fileDiff = parseDiffFromFile(null, {
			name: "sample.ts",
			contents: "export const answer = 42;",
			cacheKey: "sample.ts:answer",
		});

		render(
			<PierreDiffProvider>
				<PrimeDiff fileDiff={fileDiff} />
			</PierreDiffProvider>,
		);

		await waitFor(() => {
			expect(mocks.preloadHighlighter).toHaveBeenCalledTimes(1);
			expect(mocks.primeDiffHighlightCache).toHaveBeenCalledWith(fileDiff);
		});
		expect(mocks.preloadHighlighter).toHaveBeenCalledWith({
			themes: ["pierre-dark", "pierre-light"],
			langs: ["text"],
			preferredHighlighter: "shiki-js",
		});
		expect(mocks.providerProps?.poolOptions.poolSize).toBe(2);
		expect(mocks.providerProps?.poolOptions.totalASTLRUCacheSize).toBe(120);
		expect(mocks.providerProps?.highlighterOptions.langs).toEqual(["text"]);
		expect(mocks.providerProps?.highlighterOptions.theme).toEqual({
			dark: "pierre-dark",
			light: "pierre-light",
		});
	});
});
