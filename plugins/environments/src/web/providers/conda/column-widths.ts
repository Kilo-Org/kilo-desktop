/**
 * Column sizing for the conda environments table.
 *
 * The table is `table-fixed`, so a column's rendered width comes straight from
 * the `<colgroup>` rather than from content measurement. Keeping the arithmetic
 * here — free of DOM and React — lets the panel own only the pointer/keyboard
 * plumbing, and lets the sizing rules be exercised directly.
 */

/**
 * Only the leading column carries an explicit width; "prefix" takes whatever is
 * left so the table always totals its container and never scrolls sideways.
 */
export type EnvironmentColumnId = "name";

export type ColumnWidths = Record<EnvironmentColumnId, number>;

/** Resizable columns of the create-environment package grid. "Package" absorbs the slack. */
export type PackageGridColumnId = "size" | "version";

export type PackageGridColumnWidths = Record<PackageGridColumnId, number>;

/**
 * Sized columns of the environment detail package table. "Channel" absorbs the
 * remainder, while the selection and actions columns stay pinned, so the row
 * always fits its container.
 */
export type PackageTableColumnId = "name" | "version" | "source";

export type PackageTableColumnWidths = Record<PackageTableColumnId, number>;

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { name: 240 };

export const DEFAULT_PACKAGE_GRID_COLUMN_WIDTHS: PackageGridColumnWidths = {
	size: 80,
	version: 128,
};

/** Narrow enough to be useful, wide enough that the header label stays legible. */
export const MIN_COLUMN_WIDTH = 120;

/** The package grid's columns hold a file size and a version picker, so they go narrower. */
export const MIN_PACKAGE_GRID_COLUMN_WIDTH = 56;

/** Per-keypress adjustment when resizing a column from the keyboard. */
export const KEYBOARD_RESIZE_STEP = 16;

/**
 * Absolute ceiling for a persisted width. Any real container is narrower than
 * this; a stored value larger than this is either corrupt state or came from a
 * previous session on a wildly different monitor, and the runtime container
 * cap would clamp it back down anyway. Refusing it on read means a bad
 * `localStorage` entry can never push a column past the table on first paint.
 */
export const MAX_COLUMN_WIDTH = 4096;

export function resizeColumn<Column extends string>(
	widths: Record<Column, number>,
	column: Column,
	deltaPx: number,
	minWidth: number = MIN_COLUMN_WIDTH,
	maxWidth: number = Number.POSITIVE_INFINITY,
): Record<Column, number> {
	const requested = Math.round(widths[column] + deltaPx);
	// The minimum wins a contradictory bound: a column too narrow to read is
	// worse than one that pushes a neighbour to its own minimum.
	const capped = Math.min(requested, Math.max(maxWidth, minWidth));
	const next = Math.max(minWidth, capped);
	if (next === widths[column]) return widths;
	return { ...widths, [column]: next };
}

export const COLUMN_WIDTHS_STORAGE_KEY = "anaconda.environments.conda.columnWidths";

export const PACKAGE_GRID_COLUMN_WIDTHS_STORAGE_KEY =
	"anaconda.environments.conda.packageColumnWidths";

function getLocalStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function readColumnWidths(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): ColumnWidths {
	return readWidths(COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_COLUMN_WIDTHS, MIN_COLUMN_WIDTH, storage);
}

export function writeColumnWidths(
	widths: ColumnWidths,
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
	writeWidths(COLUMN_WIDTHS_STORAGE_KEY, widths, storage);
}

export function readPackageGridColumnWidths(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): PackageGridColumnWidths {
	return readWidths(
		PACKAGE_GRID_COLUMN_WIDTHS_STORAGE_KEY,
		DEFAULT_PACKAGE_GRID_COLUMN_WIDTHS,
		MIN_PACKAGE_GRID_COLUMN_WIDTH,
		storage,
	);
}

export function writePackageGridColumnWidths(
	widths: PackageGridColumnWidths,
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
	writeWidths(PACKAGE_GRID_COLUMN_WIDTHS_STORAGE_KEY, widths, storage);
}

function readWidths<Column extends string>(
	key: string,
	defaults: Record<Column, number>,
	minWidth: number,
	storage: Pick<Storage, "getItem"> | null,
): Record<Column, number> {
	if (!storage) return defaults;
	try {
		const raw = storage.getItem(key);
		if (!raw) return defaults;
		return parseWidths(JSON.parse(raw), defaults, minWidth);
	} catch {
		return defaults;
	}
}

function writeWidths<Column extends string>(
	key: string,
	widths: Record<Column, number>,
	storage: Pick<Storage, "setItem"> | null,
): void {
	if (!storage) return;
	try {
		storage.setItem(key, JSON.stringify(widths));
	} catch {
		// A full or unavailable quota must not break resizing.
	}
}

function parseWidths<Column extends string>(
	value: unknown,
	defaults: Record<Column, number>,
	minWidth: number,
): Record<Column, number> {
	if (typeof value !== "object" || value === null) return defaults;
	const candidate = value as Partial<Record<Column, unknown>>;
	const parsed = {} as Record<Column, number>;
	for (const column of Object.keys(defaults) as Column[]) {
		parsed[column] = parseWidth(candidate[column], defaults[column], minWidth);
	}
	return parsed;
}

function parseWidth(value: unknown, fallback: number, minWidth: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const rounded = Math.round(value);
	// Clamp against both the type-wide minimum and an absolute ceiling so
	// corrupt or stale storage entries can never push a column beyond the
	// container on first paint.
	return Math.min(MAX_COLUMN_WIDTH, Math.max(minWidth, rounded));
}

export const DEFAULT_PACKAGE_TABLE_COLUMN_WIDTHS: PackageTableColumnWidths = {
	name: 240,
	version: 130,
	source: 130,
};

export const PACKAGE_TABLE_COLUMN_WIDTHS_STORAGE_KEY =
	"anaconda.environments.conda.packageTableColumnWidths";

export function readPackageTableColumnWidths(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): PackageTableColumnWidths {
	return readWidths(
		PACKAGE_TABLE_COLUMN_WIDTHS_STORAGE_KEY,
		DEFAULT_PACKAGE_TABLE_COLUMN_WIDTHS,
		MIN_COLUMN_WIDTH,
		storage,
	);
}

export function writePackageTableColumnWidths(
	widths: PackageTableColumnWidths,
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
	writeWidths(PACKAGE_TABLE_COLUMN_WIDTHS_STORAGE_KEY, widths, storage);
}
