import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLoadingProgress } from "./use-loading-progress.js";

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function renderProgress(loading: boolean) {
	return renderHook(({ loading }) => useLoadingProgress(loading), { initialProps: { loading } });
}

describe("useLoadingProgress", () => {
	it("stays idle while nothing loads", () => {
		const { result } = renderProgress(false);
		act(() => vi.advanceTimersByTime(1_000));
		expect(result.current).toBe(0);
	});

	it("seeds on load, creeps towards the asymptote, then completes and fades out", () => {
		const { result, rerender } = renderProgress(true);
		expect(result.current).toBe(4);
		act(() => vi.advanceTimersByTime(120 * 200));
		expect(result.current).toBe(90);

		rerender({ loading: false });
		expect(result.current).toBe(100);
		act(() => vi.advanceTimersByTime(220));
		expect(result.current).toBe(0);
	});

	it("reseeds when a load starts during the fade-out, cancelling it", () => {
		const { result, rerender } = renderProgress(true);
		act(() => vi.advanceTimersByTime(120 * 5));
		expect(result.current).toBeGreaterThan(4);

		rerender({ loading: false });
		act(() => vi.advanceTimersByTime(100));
		rerender({ loading: true });
		expect(result.current).toBe(4);
		act(() => vi.advanceTimersByTime(220));
		expect(result.current).toBeGreaterThan(4);
	});
});
