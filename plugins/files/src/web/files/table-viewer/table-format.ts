import type { BinaryTableFormat } from "../../../contracts/schemas.js";

export type CsvDelimiter = "," | "\t";

export type TableViewKind =
	| { readonly kind: "delimited"; readonly delimiter: CsvDelimiter }
	| { readonly kind: "binary"; readonly format: BinaryTableFormat };

const TABLE_VIEW_KINDS: Readonly<Record<string, TableViewKind>> = {
	csv: { kind: "delimited", delimiter: "," },
	tsv: { kind: "delimited", delimiter: "\t" },
	parquet: { kind: "binary", format: "parquet" },
};

/** Must stay in step with `BINARY_TABLE_TYPES` in main's FilesService. */
export function tableViewKind(relativePath: string): TableViewKind | null {
	const name = relativePath.split("/").at(-1) ?? relativePath;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return null;
	return TABLE_VIEW_KINDS[name.slice(dot + 1).toLowerCase()] ?? null;
}
