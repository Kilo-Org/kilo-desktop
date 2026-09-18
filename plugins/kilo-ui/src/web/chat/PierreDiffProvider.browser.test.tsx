import { act, cleanup, render, waitFor } from "@testing-library/react";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk, createFakeTheme } from "@kilo-desktop/testing";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type * as PierreDiffsReactModule from "@pierre/diffs/react";

const mocks = vi.hoisted(() => ({
	primeDiffHighlightCache: vi.fn(),
	setRenderOptions: vi.fn(() => Promise.resolve()),
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
		setRenderOptions: mocks.setRenderOptions,
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
	mocks.primeDiffHighlightCache.mockClear();
	mocks.setRenderOptions.mockClear();
	mocks.providerProps = undefined;
});

describe("PierreDiffProvider", () => {
	it("initializes highlighting and updates the existing worker pool on theme changes", async () => {
		const theme = createFakeTheme();
		const sdk = createFakeSdk({ featureId: "kilo-ui", theme });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		const fileDiff = parseDiffFromFile(null, {
			name: "sample.ts",
			contents: "export const answer = 42;",
			cacheKey: "sample.ts:answer",
		});

		render(
			<SdkProvider system={system}>
				<PierreDiffProvider>
					<PrimeDiff fileDiff={fileDiff} />
				</PierreDiffProvider>
			</SdkProvider>,
		);

		await waitFor(() => expect(mocks.primeDiffHighlightCache).toHaveBeenCalledWith(fileDiff));
		expect(mocks.providerProps?.poolOptions.poolSize).toBe(2);
		expect(mocks.providerProps?.poolOptions.totalASTLRUCacheSize).toBe(120);
		expect(mocks.providerProps?.highlighterOptions.langs).toEqual(["text"]);
		expect(mocks.providerProps?.highlighterOptions.theme).toBe("pierre-light");
		await act(async () => theme.setAppearance({ ...theme.appearance(), shiki: "github-light" }));
		await waitFor(() => {
			expect(mocks.setRenderOptions).toHaveBeenLastCalledWith({ theme: "github-light" });
		});
	});
});
