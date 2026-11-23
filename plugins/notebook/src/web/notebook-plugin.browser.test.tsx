import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { NOTEBOOK_COMMANDS, NOTEBOOK_PANE_KIND } from "../contracts/index.js";
import type { Pane, PaneImplementation } from "@kilo-desktop/plugin-work-sessions/contracts";

import { bootNotebookHost } from "../test/notebook-host.js";

describe("kilo.notebook in the window", () => {
	it("contributes the Notebook pane kind, gated on sign-in like origin's tab", async () => {
		const host = await bootNotebookHost();

		expect(host.paneKind().metadata).toMatchObject({
			title: "Notebook",
			keepAlive: true,
			layoutKind: "notebook",
			launch: { newSession: true, inSession: true },
			availableWhen: { all: ["kilo.core/signedIn"] },
			unavailableHint: "Sign in to Kilo to use embedded notebooks.",
		});
	});

	it("renders without kilo.core's account, as when nothing gates notebooks", async () => {
		const host = await bootNotebookHost({ account: null });
		host.renderPane();

		await expect.element(page.getByTestId("notebook-view")).toBeVisible();
	});

	it("opens a Notebook pane the way a person does from its command", async () => {
		const host = await bootNotebookHost();

		await host.renderer.commands.execute(NOTEBOOK_COMMANDS.open);

		expect(host.openedPanes).toEqual([{ kind: NOTEBOOK_PANE_KIND }]);
	});

	it("names the file a Notebook pane comes from, for the tab menu's Copy path", async () => {
		const host = await bootNotebookHost();
		const { path } = host.paneKind().implementation as PaneImplementation;
		const pane = (metadata: Record<string, string>, object?: Pane["object"]): Pane => ({
			id: "p",
			kind: NOTEBOOK_PANE_KIND,
			title: "p",
			ordinal: 1,
			metadata,
			...(object ? { object } : {}),
		});

		expect(path!(pane({ notebookPath: "/work/a.ipynb" }))).toBe("/work/a.ipynb");
		expect(path!(pane({}, { type: "kilo.work-sessions/file", id: "/work/b.ipynb" }))).toBe(
			"/work/b.ipynb",
		);
		expect(path!(pane({}))).toBeUndefined();
	});
});
