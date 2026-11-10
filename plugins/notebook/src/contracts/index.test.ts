import { describe, expect, it } from "vitest";

import { ELECTRON_HOST_PROTOCOL_VERSION } from "@runtimed/node/electron";

import {
	FILE_OBJECT_TYPE,
	notebookFileOf,
	notebookIdOf,
	notebookOpenState,
	NTERACT_ELECTRON_HOST_PROTOCOL_VERSION,
} from "./index";

const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";
const file = (id: string) => ({ type: FILE_OBJECT_TYPE, id });

describe("notebook host contract", () => {
	it("matches the protocol implemented by the installed nteract adapter", () => {
		expect(NTERACT_ELECTRON_HOST_PROTOCOL_VERSION).toBe(ELECTRON_HOST_PROTOCOL_VERSION);
	});
});

describe("a Notebook pane's notebook", () => {
	it("is the id main recorded, when it is a UUID", () => {
		expect(notebookIdOf({ id: "pane_1", metadata: { notebookId: NOTEBOOK_ID } })).toBe(NOTEBOOK_ID);
		expect(notebookIdOf({ id: "pane_1", metadata: { notebookId: "nope" } })).toBeUndefined();
	});

	it("is origin's tab id for handed-over scratch notebooks, legacy prefix stripped", () => {
		expect(notebookIdOf({ id: NOTEBOOK_ID, metadata: {} })).toBe(NOTEBOOK_ID);
		expect(notebookIdOf({ id: `notebook.notebook:${NOTEBOOK_ID}`, metadata: {} })).toBe(
			NOTEBOOK_ID,
		);
		expect(notebookIdOf({ id: "pane_1", metadata: {} })).toBeUndefined();
	});

	it("waits for main while a file opens or a file pane has none", () => {
		expect(
			notebookIdOf({ id: NOTEBOOK_ID, metadata: { notebookOpenState: "opening" } }),
		).toBeUndefined();
		expect(
			notebookIdOf({ id: NOTEBOOK_ID, object: file("/w/a.ipynb"), metadata: {} }),
		).toBeUndefined();
	});

	it("comes from its file: the opened path, else the object it was opened for", () => {
		expect(
			notebookFileOf({ object: file("/w/a.ipynb"), metadata: { notebookPath: "/real/a.ipynb" } }),
		).toBe("/real/a.ipynb");
		expect(notebookFileOf({ object: file("/w/a.ipynb"), metadata: {} })).toBe("/w/a.ipynb");
		expect(
			notebookFileOf({ object: { type: "kilo.work-sessions/url", id: "x" }, metadata: {} }),
		).toBeUndefined();
		expect(notebookOpenState({ notebookOpenState: "weird" })).toBeUndefined();
	});
});
