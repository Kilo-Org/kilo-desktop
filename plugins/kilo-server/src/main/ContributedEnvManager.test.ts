import { describe, expect, it, vi } from "vitest";

import { ContributedEnvManager } from "./ContributedEnvManager.js";

function createHarness() {
	const onChange = vi.fn();
	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const manager = new ContributedEnvManager(onChange, logger);
	return { manager, onChange, logger };
}

describe("ContributedEnvManager", () => {
	describe("contribute", () => {
		it("adds env from a single source", () => {
			const { manager } = createHarness();
			manager.contribute("source-a", { API_KEY: "abc123", OTHER: "val" });

			expect(manager.getMergedEnv()).toEqual({ API_KEY: "abc123", OTHER: "val" });
			expect(manager.size).toBe(1);
		});

		it("fires onChange when a new contribution is added", () => {
			const { manager, onChange } = createHarness();
			manager.contribute("source-a", { KEY: "value" });

			expect(onChange).toHaveBeenCalledOnce();
		});

		it("does not fire onChange when an identical contribution replaces itself", () => {
			const { manager, onChange } = createHarness();
			manager.contribute("source-a", { KEY: "value" });
			onChange.mockClear();

			manager.contribute("source-a", { KEY: "value" });
			expect(onChange).not.toHaveBeenCalled();
		});

		it("fires onChange when a contribution changes value", () => {
			const { manager, onChange } = createHarness();
			manager.contribute("source-a", { KEY: "old" });
			onChange.mockClear();

			manager.contribute("source-a", { KEY: "new" });
			expect(onChange).toHaveBeenCalledOnce();
		});

		it("fires onChange when keys are added to an existing contribution", () => {
			const { manager, onChange } = createHarness();
			manager.contribute("source-a", { KEY: "value" });
			onChange.mockClear();

			manager.contribute("source-a", { KEY: "value", EXTRA: "more" });
			expect(onChange).toHaveBeenCalledOnce();
		});

		it("fires onChange when keys are removed from an existing contribution", () => {
			const { manager, onChange } = createHarness();
			manager.contribute("source-a", { KEY: "value", EXTRA: "more" });
			onChange.mockClear();

			manager.contribute("source-a", { KEY: "value" });
			expect(onChange).toHaveBeenCalledOnce();
		});

		it("overwrites a previous contribution from the same source", () => {
			const { manager } = createHarness();
			manager.contribute("source-a", { OLD_KEY: "old" });
			manager.contribute("source-a", { NEW_KEY: "new" });

			expect(manager.getMergedEnv()).toEqual({ NEW_KEY: "new" });
			expect(manager.size).toBe(1);
		});
	});

	describe("disposer", () => {
		it("removes the contribution and fires onChange", () => {
			const { manager, onChange } = createHarness();
			const dispose = manager.contribute("source-a", { KEY: "value" });
			onChange.mockClear();

			dispose();
			expect(manager.getMergedEnv()).toEqual({});
			expect(manager.size).toBe(0);
			expect(onChange).toHaveBeenCalledOnce();
		});

		it("is idempotent — second call is a no-op", () => {
			const { manager, onChange } = createHarness();
			const dispose = manager.contribute("source-a", { KEY: "value" });
			onChange.mockClear();

			dispose();
			dispose();
			expect(onChange).toHaveBeenCalledOnce();
		});

		it("does not remove a newer contribution from the same source", () => {
			const { manager, onChange } = createHarness();
			const firstDispose = manager.contribute("source-a", { KEY: "first" });
			manager.contribute("source-a", { KEY: "second" });
			onChange.mockClear();

			firstDispose();
			// Should not remove "second" since it was registered after "first"
			expect(manager.getMergedEnv()).toEqual({ KEY: "second" });
			expect(onChange).not.toHaveBeenCalled();
		});
	});

	describe("getMergedEnv", () => {
		it("returns empty object when no contributions exist", () => {
			const { manager } = createHarness();
			expect(manager.getMergedEnv()).toEqual({});
		});

		it("merges env from multiple sources", () => {
			const { manager } = createHarness();
			manager.contribute("source-a", { KEY_A: "a" });
			manager.contribute("source-b", { KEY_B: "b" });

			expect(manager.getMergedEnv()).toEqual({ KEY_A: "a", KEY_B: "b" });
		});

		it("uses last-write-wins for duplicate keys and warns", () => {
			const { manager, logger } = createHarness();
			manager.contribute("source-a", { SHARED: "from-a" });
			manager.contribute("source-b", { SHARED: "from-b" });

			const merged = manager.getMergedEnv();
			expect(merged.SHARED).toBe("from-b");
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Env key "SHARED" contributed by both "source-a" and "source-b"'),
			);
		});

		it("does not warn when the same source overwrites its own key", () => {
			const { manager, logger } = createHarness();
			manager.contribute("source-a", { KEY: "first" });
			manager.contribute("source-a", { KEY: "second" });

			const merged = manager.getMergedEnv();
			expect(merged.KEY).toBe("second");
			expect(logger.warn).not.toHaveBeenCalled();
		});
	});

	describe("size", () => {
		it("tracks the number of active contributions", () => {
			const { manager } = createHarness();
			expect(manager.size).toBe(0);

			const disposeA = manager.contribute("source-a", { A: "1" });
			expect(manager.size).toBe(1);

			manager.contribute("source-b", { B: "2" });
			expect(manager.size).toBe(2);

			disposeA();
			expect(manager.size).toBe(1);
		});
	});

	// Regression: PR #116 review — WARNING ContributedEnvManager.ts:54.
	// The doc-and-log said "last-write-wins" but Map iteration is INSERTION
	// order; a source re-contributing after another source's first
	// contribution would still lose because its slot was allocated earlier.
	// Fix: delete-then-set on every contribute() so the entry moves to the
	// tail of iteration order.
	describe("last-write-wins (recency)", () => {
		it("gives the last CONTRIBUTOR the winning value when the same key overlaps", () => {
			const { manager } = createHarness();
			manager.contribute("first", { SHARED: "from-first" });
			manager.contribute("second", { SHARED: "from-second" });
			expect(manager.getMergedEnv().SHARED).toBe("from-second");
		});

		it("gives an older source the winning value if it re-contributes AFTER a competing source", () => {
			// Before the fix, re-contributing from "first" moved the value in
			// the Map slot but not the iteration position, so "second" (a
			// later Map insertion) still won at merge time — the opposite of
			// last-write-wins.
			const { manager } = createHarness();
			manager.contribute("first", { SHARED: "v1" });
			manager.contribute("second", { SHARED: "from-second" });
			manager.contribute("first", { SHARED: "v2-from-first" });
			expect(manager.getMergedEnv().SHARED).toBe("v2-from-first");
		});
	});
});
