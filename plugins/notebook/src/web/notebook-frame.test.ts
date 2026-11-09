import { describe, expect, it } from "vitest";

import { notebookHostConnectionArgs, notebookOriginFrom, nteractSrcFor } from "./notebook-frame.js";

const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";

describe("the notebook frame", () => {
	it("derives the notebook origin by substituting the host on the window's own", () => {
		// The window cannot tell whether the app is packaged, so the scheme has to come from its
		// own origin — otherwise a dev build would frame the production host.
		expect(notebookOriginFrom("kilo-desktop://app")).toBe("kilo-desktop://notebook");
		expect(notebookOriginFrom("kilo-desktop-dev://app")).toBe("kilo-desktop-dev://notebook");
	});

	it("has no notebook origin in browser mode, where the protocol does not exist", () => {
		expect(notebookOriginFrom("http://localhost:5173")).toBeUndefined();
		expect(notebookOriginFrom("not a url")).toBeUndefined();
	});

	it("selects the Electron host and exact parent origin under the desktop scheme", () => {
		const url = new URL(nteractSrcFor(NOTEBOOK_ID, { protocol: "kilo-desktop:", host: "app" })!);

		expect(`${url.protocol}//${url.host}`).toBe("kilo-desktop://notebook");
		expect(url.searchParams.get("notebook_id")).toBe(NOTEBOOK_ID);
		expect(url.searchParams.get("nteract-host")).toBe("electron");
		expect(url.searchParams.get("nteract-parent-origin")).toBe("kilo-desktop://app");
	});

	it("frames a development origin in browser mode, and nothing without one", () => {
		const location = { protocol: "http:", host: "localhost:5173" };

		expect(nteractSrcFor(NOTEBOOK_ID, location, "http://localhost:8737")).toBe(
			`http://localhost:8737/?notebook_id=${NOTEBOOK_ID}`,
		);
		expect(nteractSrcFor(NOTEBOOK_ID, location)).toBeUndefined();
	});

	it("connects a file notebook with its path, and a scratch one with the session's folder", () => {
		expect(
			notebookHostConnectionArgs({
				notebookId: NOTEBOOK_ID,
				sessionId: "wses_1",
				title: "analysis.ipynb",
				directory: "/projects",
				metadata: { objectType: "kilo.workspaces/file", objectId: "/projects/analysis.ipynb" },
			}),
		).toEqual({
			notebookId: NOTEBOOK_ID,
			sessionId: "wses_1",
			title: "analysis.ipynb",
			notebookPath: "/projects/analysis.ipynb",
			workingDirectory: "/projects",
		});
		expect(
			notebookHostConnectionArgs({
				notebookId: NOTEBOOK_ID,
				sessionId: "wses_1",
				title: "Notebook",
				directory: null,
				metadata: {},
			}),
		).toEqual({ notebookId: NOTEBOOK_ID, sessionId: "wses_1", title: "Notebook" });
	});
});
