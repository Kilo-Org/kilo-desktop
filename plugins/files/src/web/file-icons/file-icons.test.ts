import { createFileTreeIconResolver } from "@pierre/trees";
import { describe, expect, it } from "vitest";

import { FILE_ICONS, NOTEBOOK_FILE_ICON_NAME, TABLE_FILE_ICON_NAME } from "./file-icons.js";

describe("file icons", () => {
	const resolve = (path: string) =>
		createFileTreeIconResolver(FILE_ICONS).resolveIcon("file-tree-icon-file", path);

	it("gives every table-viewer format the same table icon", () => {
		expect(resolve("data/report.csv").name).toBe(TABLE_FILE_ICON_NAME);
		expect(resolve("data/report.tsv").name).toBe(TABLE_FILE_ICON_NAME);
		expect(resolve("data/report.parquet").name).toBe(TABLE_FILE_ICON_NAME);
		expect(resolve("DATA/REPORT.PARQUET").name).toBe(TABLE_FILE_ICON_NAME);
	});

	it("keeps the notebook icon and the generic file fallback", () => {
		expect(resolve("analysis.ipynb").name).toBe(NOTEBOOK_FILE_ICON_NAME);
		expect(resolve("model.bin").name).not.toBe(TABLE_FILE_ICON_NAME);
	});
});
