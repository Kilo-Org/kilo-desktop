import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useProviderNotReadySince } from "./useProviderNotReadySince";

afterEach(() => {
	cleanup();
});

type Args = { notReady: boolean; resolved: boolean; failedAt: number };

describe("useProviderNotReadySince", () => {
	it("returns null before any settled not-ready failure", () => {
		const { result } = renderHook(() =>
			useProviderNotReadySince({ notReady: false, resolved: false, failedAt: 0 }),
		);
		expect(result.current).toBeNull();
	});

	it("stamps a start time on the first settled not-ready failure", () => {
		const { result } = renderHook(() =>
			useProviderNotReadySince({ notReady: true, resolved: false, failedAt: 1_000 }),
		);
		expect(result.current).toBe(1_000);
	});

	it("holds the start time across a transient not-ready=false while still unresolved", () => {
		// Reproduces the TanStack poll window: a still-empty query flips back to
		// pending (notReady=false) at the start of each background refetch, but
		// the backend has NOT recovered (resolved stays false). The clock must
		// not reset, otherwise the 120s startup window never accumulates.
		const { result, rerender } = renderHook((args: Args) => useProviderNotReadySince(args), {
			initialProps: { notReady: true, resolved: false, failedAt: 1_000 },
		});
		expect(result.current).toBe(1_000);

		rerender({ notReady: false, resolved: false, failedAt: 1_000 }); // refetch in flight
		rerender({ notReady: false, resolved: false, failedAt: 1_000 });
		expect(result.current).toBe(1_000);

		rerender({ notReady: true, resolved: false, failedAt: 4_000 }); // refetch settled not-ready again
		expect(result.current).toBe(1_000);
	});

	it("resets to null once the read resolves, and re-stamps on the next outage", () => {
		const { result, rerender } = renderHook((args: Args) => useProviderNotReadySince(args), {
			initialProps: { notReady: true, resolved: false, failedAt: 1_000 },
		});
		expect(result.current).toBe(1_000);

		rerender({ notReady: false, resolved: true, failedAt: 1_000 }); // success (or a different settled error)
		expect(result.current).toBeNull();

		rerender({ notReady: true, resolved: false, failedAt: 9_000 });
		expect(result.current).toBe(9_000);
	});
});
