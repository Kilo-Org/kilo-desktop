import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useProviderNotReadySince } from "./useProviderNotReadySince";

afterEach(() => {
	cleanup();
});

type Args = { notReady: boolean; resolved: boolean };

describe("useProviderNotReadySince", () => {
	it("returns null before any settled not-ready failure", () => {
		const { result } = renderHook(() =>
			useProviderNotReadySince({ notReady: false, resolved: false }),
		);
		expect(result.current).toBeNull();
	});

	it("stamps a start time on the first settled not-ready failure", () => {
		const before = Date.now();
		const { result } = renderHook(() =>
			useProviderNotReadySince({ notReady: true, resolved: false }),
		);
		expect(result.current).not.toBeNull();
		expect(result.current!).toBeGreaterThanOrEqual(before);
	});

	it("holds the start time across a transient not-ready=false while still unresolved", () => {
		// Reproduces the TanStack poll window: a still-empty query flips back to
		// pending (notReady=false) at the start of each background refetch, but
		// the backend has NOT recovered (resolved stays false). The clock must
		// not reset, otherwise the 120s startup window never accumulates.
		const { result, rerender } = renderHook((args: Args) => useProviderNotReadySince(args), {
			initialProps: { notReady: true, resolved: false },
		});
		const first = result.current;
		expect(first).not.toBeNull();

		rerender({ notReady: false, resolved: false }); // refetch in flight
		rerender({ notReady: false, resolved: false });
		expect(result.current).toBe(first);

		rerender({ notReady: true, resolved: false }); // refetch settled not-ready again
		expect(result.current).toBe(first);
	});

	it("resets to null once the read resolves, and re-stamps on the next outage", () => {
		const { result, rerender } = renderHook((args: Args) => useProviderNotReadySince(args), {
			initialProps: { notReady: true, resolved: false },
		});
		const first = result.current;
		expect(first).not.toBeNull();

		rerender({ notReady: false, resolved: true }); // success (or a different settled error)
		expect(result.current).toBeNull();

		rerender({ notReady: true, resolved: false });
		expect(result.current).not.toBeNull();
		expect(result.current!).toBeGreaterThanOrEqual(first!);
	});
});
