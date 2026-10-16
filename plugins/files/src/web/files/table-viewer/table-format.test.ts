import { describe, expect, it } from "vitest";

import { tableViewKind } from "./table-format.js";

describe("tableViewKind", () => {
	it("routes delimited text to the editable table view with its delimiter", () => {
		expect(tableViewKind("data/sales.csv")).toEqual({ kind: "delimited", delimiter: "," });
		expect(tableViewKind("REPORT.CSV")).toEqual({ kind: "delimited", delimiter: "," });
		expect(tableViewKind("export.tsv")).toEqual({ kind: "delimited", delimiter: "\t" });
	});

	it("routes Parquet files to the read-only binary table view", () => {
		expect(tableViewKind("warehouse/part-0.parquet")).toEqual({
			kind: "binary",
			format: "parquet",
		});
	});

	it("leaves other files on their existing viewers", () => {
		for (const relativePath of [
			"notes.md",
			"data.json",
			"csv",
			"archive.csv.gz",
			"a.ipynb",
			"frame.arrow",
			"frame.feather",
		]) {
			expect(tableViewKind(relativePath)).toBeNull();
		}
	});
});
