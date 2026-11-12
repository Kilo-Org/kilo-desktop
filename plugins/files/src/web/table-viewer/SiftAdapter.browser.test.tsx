import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { bootFilesHost, filesPane, PaneHost } from "../../test/files-host.js";
import type { DocumentMethods } from "../documents.js";
import parquetUrl from "./fixtures/synthetic.parquet?url";
import { siftRuntime } from "./sift-adapter.js";
import { TABLE_LOAD_LIMITS } from "./table-limits.js";
import type * as SiftModule from "@nteract/sift";
import type { SiftLoadState, SiftTableSource } from "./sift-runtime.js";

/*
 * Real @nteract/sift and @nteract/sift-csv behind the adapter. `loadTableFile`
 * is wrapped only to observe store disposal and to hold one load open; it
 * still delegates to the real WASM loader.
 */
const sift = vi.hoisted(() => ({
	disposed: [] as string[],
	gate: null as Promise<void> | null,
	options: [] as unknown[],
}));

vi.mock("@nteract/sift", async (importOriginal) => {
	const actual = await importOriginal<typeof SiftModule>();
	return {
		...actual,
		loadTableFile: async (...args: Parameters<typeof actual.loadTableFile>) => {
			sift.options.push(args[1]);
			// The gate holds exactly one load (the first after it is set) so a
			// replacement source can finish while the superseded one is pending.
			const gate = sift.gate;
			sift.gate = null;
			if (gate) await gate;
			const data = await actual.loadTableFile(...args);
			const label = `${String(data.rowCount)}:${String(args[0].byteLength)}`;
			const dispose = data.dispose?.bind(data);
			data.dispose = () => {
				sift.disposed.push(label);
				dispose?.();
			};
			return data;
		},
	};
});

const { TableView } = siftRuntime;

async function syntheticParquet(): Promise<Uint8Array> {
	return new Uint8Array(await (await fetch(parquetUrl)).arrayBuffer());
}

function harness(initial: SiftTableSource) {
	const states: SiftLoadState[] = [];
	const errors: string[] = [];
	const tree = (source: SiftTableSource) => (
		<div style={{ display: "flex", height: 500, width: 900 }}>
			<TableView
				ariaLabel="fixture"
				onError={(message) => errors.push(message)}
				onLoadStateChange={(state) => states.push(state)}
				source={source}
			/>
		</div>
	);
	const view = render(tree(initial));
	return { states, errors, rerender: (next: SiftTableSource) => view.rerender(tree(next)), view };
}

beforeEach(() => {
	sift.disposed.length = 0;
	sift.gate = null;
	sift.options.length = 0;
});

afterEach(() => {
	cleanup();
});

describe("Sift adapter (real @nteract/sift)", () => {
	it("renders a synthetic CSV with UTF-8 values, inferred numbers and nulls", async () => {
		const { states, errors } = harness({
			kind: "csv",
			text: "city,score\nÅre,3\nOslo,1\n,2\n",
			delimiter: ",",
		});
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });
		expect(errors).toEqual([]);
		await expect.element(page.getByText("Åre").first()).toBeVisible();
		await expect.element(page.getByText("score").first()).toBeVisible();
	});

	it("shows empty and quoted-empty fields as null and literal null/NA as text", async () => {
		const { states } = harness({
			kind: "csv",
			text: 'label,note\nunquoted,\nquoted,""\nliteral,null\nna,NA\n',
			delimiter: ",",
		});
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });
		const notes = Array.from(document.querySelectorAll(".sift-row"), (row) => {
			const cell = row.querySelectorAll(".sift-cell")[1];
			return cell?.querySelector(".sift-badge-null") ? "<null>" : cell?.textContent;
		});
		expect(notes).toEqual(["<null>", "<null>", "null", "NA"]);
	});

	it("labels the first column without the UTF-8 BOM that the editor draft keeps", async () => {
		const { states } = harness({ kind: "csv", text: "\uFEFFid,name\n1,a\n", delimiter: "," });
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });
		const labels = Array.from(
			document.querySelectorAll(".sift-th-label"),
			(label) => label.textContent,
		);
		expect(labels[0]?.trim()).toMatch(/^id$/iu);
		expect(labels.join("")).not.toContain("\uFEFF");
	});

	it("parses TSV with the tab delimiter", async () => {
		const { states } = harness({ kind: "csv", text: "a\tb\nx\t1\n", delimiter: "\t" });
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });
		await expect.element(page.getByText("x", { exact: true }).first()).toBeVisible();
	});

	it("keeps a quoted multi-line field as one record", async () => {
		const { states, errors } = harness({
			kind: "csv",
			text: 'id,note\n1,"first line\nsecond line"\n2,plain\n',
			delimiter: ",",
		});
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });
		expect(errors).toEqual([]);
		await expect.element(page.getByText("plain").first()).toBeVisible();
	});

	it("reports ragged CSV instead of rendering a partial table", async () => {
		const ragged = harness({ kind: "csv", text: "a,b\n1,2,3\n", delimiter: "," });
		await vi.waitFor(() => expect(ragged.errors.length).toBe(1), { timeout: 10_000 });
		expect(ragged.errors[0]).toMatch(/unequal lengths/u);
		expect(ragged.states).not.toContain("complete");
	});

	it("scrolls horizontally when the columns are wider than the pane", async () => {
		const columns = Array.from({ length: 30 }, (_, index) => `column_${index}`);
		const text = `${columns.join(",")}\n${columns.map((_, index) => index * 1000).join(",")}\n`;
		const states: SiftLoadState[] = [];
		render(
			<div style={{ display: "flex", height: 400, width: 400 }}>
				<TableView
					ariaLabel="narrow"
					onError={() => undefined}
					onLoadStateChange={(state) => states.push(state)}
					source={{ kind: "csv", text, delimiter: "," }}
				/>
			</div>,
		);
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });

		const viewport = document.querySelector<HTMLElement>(".sift-root .sift-viewport")!;
		await vi.waitFor(() => expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth));
		expect(viewport.clientWidth).toBeLessThanOrEqual(400);
		viewport.scrollLeft = 300;
		expect(viewport.scrollLeft).toBe(300);
	});

	it("passes the shared load limits to Sift for CSV and Parquet", async () => {
		const csv = harness({ kind: "csv", text: "a,b\n1,2\n", delimiter: "," });
		await vi.waitFor(() => expect(csv.states).toContain("complete"), { timeout: 10_000 });
		cleanup();
		const parquet = harness({ kind: "bytes", format: "parquet", bytes: await syntheticParquet() });
		await vi.waitFor(() => expect(parquet.states).toContain("complete"), { timeout: 10_000 });
		expect(sift.options).toEqual([
			{ format: "arrow-ipc", ...TABLE_LOAD_LIMITS },
			{ format: "parquet", ...TABLE_LOAD_LIMITS },
		]);
		expect(TABLE_LOAD_LIMITS.maxBytes).toBe(64 * 1024 * 1024);
	});

	it("renders a synthetic Parquet file from bytes", async () => {
		const { states, errors } = harness({
			kind: "bytes",
			format: "parquet",
			bytes: await syntheticParquet(),
		});
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });
		expect(errors).toEqual([]);
		await expect.element(page.getByText("Lima").first()).toBeVisible();
	});

	it("reports corrupt Parquet bytes", async () => {
		const { errors } = harness({
			kind: "bytes",
			format: "parquet",
			bytes: new TextEncoder().encode("PAR1garbagePAR1"),
		});
		await vi.waitFor(() => expect(errors.length).toBe(1), { timeout: 10_000 });
	});

	it("ignores a superseded source's delayed rejection after the replacement loads", async () => {
		let release!: () => void;
		sift.gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { states, errors, rerender } = harness({
			kind: "bytes",
			format: "parquet",
			bytes: new TextEncoder().encode("PAR1corruptPAR1"),
		});
		await vi.waitFor(() => expect(states).toContain("loading"));

		rerender({ kind: "csv", text: "fresh\nvalue\n", delimiter: "," });
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });
		await act(async () => {
			release();
			await new Promise((resolve) => setTimeout(resolve, 100));
		});

		expect(errors).toEqual([]);
		await expect.element(page.getByText("value", { exact: true }).first()).toBeVisible();
	});

	it("disposes the previous Parquet store on refresh and the current one on close", async () => {
		const bytes = await syntheticParquet();
		const { states, rerender, view } = harness({ kind: "bytes", format: "parquet", bytes });
		await vi.waitFor(() => expect(states.filter((s) => s === "complete")).toHaveLength(1), {
			timeout: 10_000,
		});

		rerender({ kind: "bytes", format: "parquet", bytes: bytes.slice() });
		await vi.waitFor(() => expect(states.filter((s) => s === "complete")).toHaveLength(2), {
			timeout: 10_000,
		});
		expect(sift.disposed).toHaveLength(1);

		view.unmount();
		expect(sift.disposed).toHaveLength(2);
	});

	it("renders real Sift by default for a CSV opened through FilesView", async () => {
		const contents = "city,score\nÅre,3\nOslo,1\n";
		const handlers: DocumentMethods = {
			list: async () => ({ paths: [], truncated: false }),
			listFiles: async () => ({ paths: [], truncated: false }),
			existingPaths: async ({ relativePaths }) => ({ paths: relativePaths }),
			resolveFileLink: async () => ({ kind: "none", paths: [], truncated: false }),
			read: async () => ({
				kind: "text",
				contents,
				byteLength: contents.length,
				truncated: false,
				revision: "a".repeat(64),
			}),
			listExternalEditors: async () => ({ editors: [] }),
			openExternalEditor: async () => ({ opened: true }),
			write: async () => ({ status: "saved", revision: "b".repeat(64) }),
			gitStatus: async () => null,
		};
		const host = await bootFilesHost({
			documents: handlers,
			panes: [filesPane("files-1", { workspaceDirectory: "/workspace", relativePath: "data.csv" })],
		});
		host.render(
			<div style={{ display: "flex", height: 500, width: 900 }}>
				<PaneHost host={host} paneId="files-1" />
			</div>,
		);
		await expect.element(page.getByText("Åre").first()).toBeVisible();
		await expect
			.element(page.getByRole("region", { name: "Table view of data.csv" }))
			.toHaveAttribute("aria-busy", "false");
	});
});
