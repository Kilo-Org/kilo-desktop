import { describe, expect, it } from "vitest";
import { z } from "zod";

import { acceptsDrag, readDraggedRefs, writeDraggedRefs, type DataTransferLike } from "./dnd";
import { defineDomain, ref } from "./domain";

const Session = defineDomain({ id: "acme.sessions/session", home: "main", state: z.object({}) });
const File = defineDomain({ id: "acme.files/file", home: "main", state: z.object({}) });
const Url = defineDomain({ id: "acme.web/url", home: "main", state: z.object({}) });

/** A minimal DataTransfer: formats are lowercased, as browsers do. */
function fakeDataTransfer(): DataTransferLike & { readonly data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		get types() {
			return [...data.keys()];
		},
		setData: (format, value) => void data.set(format.toLowerCase(), value),
		getData: (format) => data.get(format.toLowerCase()) ?? "",
	};
}

describe("object reference drag and drop", () => {
	it("round-trips references through a drag payload", () => {
		const transfer = fakeDataTransfer();

		writeDraggedRefs(transfer, [ref(Session, "s1"), ref(File, "ws:src/a.ts")]);

		expect(readDraggedRefs(transfer, [Session, File])).toEqual([
			{ type: "acme.sessions/session", id: "s1" },
			{ type: "acme.files/file", id: "ws:src/a.ts" },
		]);
	});

	it("returns only the references a target accepts", () => {
		const transfer = fakeDataTransfer();
		writeDraggedRefs(transfer, [ref(Session, "s1"), ref(File, "f1")]);

		expect(readDraggedRefs(transfer, [File])).toEqual([{ type: "acme.files/file", id: "f1" }]);
	});

	it("decides acceptance from the drag's types alone, before the drop", () => {
		const transfer = fakeDataTransfer();
		writeDraggedRefs(transfer, [ref(Session, "s1")]);

		expect(acceptsDrag(transfer, [Session, Url])).toBe(true);
		expect(acceptsDrag(transfer, [File])).toBe(false);
	});

	it("ignores payloads that are not object references", () => {
		const transfer = fakeDataTransfer();
		transfer.setData("text/plain", "hello");

		expect(acceptsDrag(transfer, [Session])).toBe(false);
		expect(readDraggedRefs(transfer, [Session])).toEqual([]);
	});
});
