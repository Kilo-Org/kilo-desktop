import { TABLE_LIMIT_BYTES } from "../../contracts/models.js";

/**
 * Ceilings for a table load, shared by the CSV and Parquet loaders. Loads are
 * whole-file on the renderer's main thread, so these bound decode time and
 * retained Arrow memory, not what Parquet or WASM can hold. The byte cap is
 * main's: a file it ships is never refused here.
 */
export const TABLE_LOAD_LIMITS = {
	maxBytes: TABLE_LIMIT_BYTES,
	maxRows: 1_000_000,
	maxColumns: 1024,
	/** Retained Arrow memory after decode; Sift checks it per batch. */
	maxDecodedBytes: 512 * 1024 * 1024,
} as const;
