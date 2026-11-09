import { describe, expect, it } from "vitest";

import {
	clampSidebarWidth,
	readStoredSidebarWidth,
	SIDEBAR_WIDTH_DEFAULT,
	SIDEBAR_WIDTH_MIN,
	SIDEBAR_WIDTH_STORAGE_KEY,
	SIDEBAR_WIDTH_VIEWPORT_RESERVE,
	writeStoredSidebarWidth,
} from "./sidebar-width";

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const data = { ...initial };
	return {
		get length() {
			return Object.keys(data).length;
		},
		clear() {
			for (const key of Object.keys(data)) delete data[key];
		},
		getItem(key: string) {
			return data[key] ?? null;
		},
		key() {
			return null;
		},
		removeItem(key: string) {
			delete data[key];
		},
		setItem(key: string, value: string) {
			data[key] = value;
		},
	};
}

describe("clampSidebarWidth", () => {
	it("keeps the default width inside a typical viewport", () => {
		expect(clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT, 1280)).toBe(256);
	});

	it("does not shrink below the minimum", () => {
		expect(clampSidebarWidth(100, 1280)).toBe(SIDEBAR_WIDTH_MIN);
	});

	it("caps width so the remaining viewport stays at least 640px", () => {
		expect(clampSidebarWidth(800, 1280)).toBe(1280 - SIDEBAR_WIDTH_VIEWPORT_RESERVE);
	});

	it("stays at the minimum when the viewport cannot leave 640px for content", () => {
		expect(clampSidebarWidth(400, 800)).toBe(SIDEBAR_WIDTH_MIN);
	});

	it("rounds to the nearest pixel", () => {
		expect(clampSidebarWidth(300.6, 1280)).toBe(301);
	});
});

describe("sidebar width persistence", () => {
	it("returns the default width when nothing is stored", () => {
		expect(readStoredSidebarWidth(memoryStorage(), 1280)).toBe(SIDEBAR_WIDTH_DEFAULT);
	});

	it("clamps the default width on a narrow viewport", () => {
		expect(readStoredSidebarWidth(memoryStorage(), 800)).toBe(SIDEBAR_WIDTH_MIN);
	});

	it("returns a previously stored width", () => {
		const storage = memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "320" });
		expect(readStoredSidebarWidth(storage, 1280)).toBe(320);
	});

	it("clamps a stored width that no longer fits the viewport", () => {
		const storage = memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "900" });
		expect(readStoredSidebarWidth(storage, 1280)).toBe(640);
	});

	it("falls back to the default width without storage or when it cannot be read", () => {
		const unreadable = {
			getItem: () => {
				throw new Error("SecurityError");
			},
		};
		const corrupt = memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "wide" });

		expect(readStoredSidebarWidth(null, 1280)).toBe(SIDEBAR_WIDTH_DEFAULT);
		expect(readStoredSidebarWidth(unreadable, 1280)).toBe(SIDEBAR_WIDTH_DEFAULT);
		expect(readStoredSidebarWidth(corrupt, 1280)).toBe(SIDEBAR_WIDTH_DEFAULT);
	});

	it("ignores storage that is missing or refuses the write", () => {
		const full = {
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
		};

		expect(() => writeStoredSidebarWidth(336, null, 1280)).not.toThrow();
		expect(() => writeStoredSidebarWidth(336, full, 1280)).not.toThrow();
	});

	it("writes the clamped width", () => {
		const storage = memoryStorage();
		writeStoredSidebarWidth(336, storage, 1280);
		expect(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("336");
	});
});
