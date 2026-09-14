import { describe, expect, it } from "vitest";

import {
	COLUMN_WIDTHS_STORAGE_KEY,
	DEFAULT_COLUMN_WIDTHS,
	DEFAULT_PACKAGE_TABLE_COLUMN_WIDTHS,
	MAX_COLUMN_WIDTH,
	MIN_COLUMN_WIDTH,
	MIN_PACKAGE_GRID_COLUMN_WIDTH,
	readColumnWidths,
	readPackageGridColumnWidths,
	readPackageTableColumnWidths,
	resizeColumn,
	writeColumnWidths,
	writePackageGridColumnWidths,
	writePackageTableColumnWidths,
} from "./column-widths.js";

describe("resizeColumn", () => {
	it("applies the drag delta to the dragged column and leaves the others alone", () => {
		const widths = { name: 240, version: 480 };

		expect(resizeColumn(widths, "name", 40)).toEqual({ name: 280, version: 480 });
	});

	it("stops at the minimum width when dragged past it", () => {
		const widths = { name: 240, version: 480 };

		expect(resizeColumn(widths, "name", -400)).toEqual({
			name: MIN_COLUMN_WIDTH,
			version: 480,
		});
	});

	it("returns the same object reference when the computed width is unchanged", () => {
		const widths = { name: MIN_COLUMN_WIDTH, version: 480 };

		expect(resizeColumn(widths, "name", -10)).toBe(widths);
		expect(resizeColumn(widths, "name", 0)).toBe(widths);
	});

	it("honours a narrower minimum for the package grid's compact columns", () => {
		const widths = { size: 80, version: 128 };

		expect(resizeColumn(widths, "size", -100, MIN_PACKAGE_GRID_COLUMN_WIDTH)).toEqual({
			size: MIN_PACKAGE_GRID_COLUMN_WIDTH,
			version: 128,
		});
	});
});

describe("DEFAULT_COLUMN_WIDTHS", () => {
	it("sizes only the leading column, leaving the rest to fill", () => {
		expect(Object.keys(DEFAULT_COLUMN_WIDTHS)).toEqual(["name"]);
	});
});

function fakeStorage(seed: Record<string, string> = {}) {
	const entries = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
	};
}

describe("column width persistence", () => {
	it("falls back to the defaults when nothing has been stored", () => {
		expect(readColumnWidths(fakeStorage())).toEqual(DEFAULT_COLUMN_WIDTHS);
	});

	it("restores widths written by a previous session", () => {
		const storage = fakeStorage();

		writeColumnWidths({ name: 320 }, storage);

		expect(readColumnWidths(storage)).toEqual({ name: 320 });
	});

	it("keeps the package grid's widths under its own key", () => {
		const storage = fakeStorage();

		writeColumnWidths({ name: 320 }, storage);
		writePackageGridColumnWidths({ size: 96, version: 160 }, storage);

		expect(readColumnWidths(storage)).toEqual({ name: 320 });
		expect(readPackageGridColumnWidths(storage)).toEqual({ size: 96, version: 160 });
	});

	it("ignores stored values that are not usable widths", () => {
		const unparseable = fakeStorage({ [COLUMN_WIDTHS_STORAGE_KEY]: "}{" });
		const wrongType = fakeStorage({
			[COLUMN_WIDTHS_STORAGE_KEY]: JSON.stringify({ name: "wide" }),
		});

		expect(readColumnWidths(unparseable)).toEqual(DEFAULT_COLUMN_WIDTHS);
		expect(readColumnWidths(wrongType)).toEqual(DEFAULT_COLUMN_WIDTHS);
	});

	it("clamps stored values below the column minimum back up to it", () => {
		const tooNarrow = fakeStorage({
			[COLUMN_WIDTHS_STORAGE_KEY]: JSON.stringify({ name: -50 }),
		});

		expect(readColumnWidths(tooNarrow)).toEqual({ name: MIN_COLUMN_WIDTH });
	});

	it("clamps stored values above the absolute ceiling back down to it", () => {
		const tooWide = fakeStorage({
			[COLUMN_WIDTHS_STORAGE_KEY]: JSON.stringify({ name: MAX_COLUMN_WIDTH * 10 }),
		});

		expect(readColumnWidths(tooWide)).toEqual({ name: MAX_COLUMN_WIDTH });
	});

	it("falls back to defaults when no storage is available", () => {
		expect(readColumnWidths(null)).toEqual(DEFAULT_COLUMN_WIDTHS);
		expect(readPackageGridColumnWidths(null)).toEqual({ size: 80, version: 128 });
		expect(readPackageTableColumnWidths(null)).toEqual(DEFAULT_PACKAGE_TABLE_COLUMN_WIDTHS);
	});

	it("silently drops a write when no storage is available", () => {
		// A missing storage must not throw; the resize experience is best-effort.
		expect(() => writeColumnWidths({ name: 320 }, null)).not.toThrow();
		expect(() => writePackageGridColumnWidths({ size: 96, version: 160 }, null)).not.toThrow();
		expect(() =>
			writePackageTableColumnWidths({ name: 300, version: 150, source: 120 }, null),
		).not.toThrow();
	});

	it("falls back gracefully when the ambient localStorage is unreachable", () => {
		// Exercised without any storage argument so the default resolution runs.
		// In the node unit environment there is no ambient localStorage; the read
		// side must still return the defaults instead of throwing.
		expect(readColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS);
		expect(() => writeColumnWidths({ name: 320 })).not.toThrow();
	});

	it("ignores stored payloads that aren't objects", () => {
		const arrayPayload = fakeStorage({ [COLUMN_WIDTHS_STORAGE_KEY]: JSON.stringify([320]) });
		const stringPayload = fakeStorage({
			[COLUMN_WIDTHS_STORAGE_KEY]: JSON.stringify("nope"),
		});
		const nullPayload = fakeStorage({ [COLUMN_WIDTHS_STORAGE_KEY]: JSON.stringify(null) });

		expect(readColumnWidths(arrayPayload)).toEqual(DEFAULT_COLUMN_WIDTHS);
		expect(readColumnWidths(stringPayload)).toEqual(DEFAULT_COLUMN_WIDTHS);
		expect(readColumnWidths(nullPayload)).toEqual(DEFAULT_COLUMN_WIDTHS);
	});
});

describe("package table columns", () => {
	it("defaults to the three data columns and keeps its own storage key", () => {
		const storage = fakeStorage();

		expect(Object.keys(DEFAULT_PACKAGE_TABLE_COLUMN_WIDTHS).toSorted()).toEqual([
			"name",
			"source",
			"version",
		]);

		writePackageTableColumnWidths({ name: 300, version: 150, source: 120 }, storage);
		writePackageGridColumnWidths({ size: 96, version: 160 }, storage);

		expect(readPackageTableColumnWidths(storage)).toEqual({
			name: 300,
			version: 150,
			source: 120,
		});
		expect(readPackageGridColumnWidths(storage)).toEqual({ size: 96, version: 160 });
	});
});

describe("resizeColumn bounds", () => {
	it("refuses to grow past the space a neighbour needs", () => {
		const widths = { name: 240 };

		expect(resizeColumn(widths, "name", 500, MIN_COLUMN_WIDTH, 400)).toEqual({ name: 400 });
	});

	it("still honours the minimum when the available space is smaller than it", () => {
		const widths = { name: 240 };

		expect(resizeColumn(widths, "name", -200, MIN_COLUMN_WIDTH, 80)).toEqual({
			name: MIN_COLUMN_WIDTH,
		});
	});
});
