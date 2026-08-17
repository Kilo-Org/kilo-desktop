import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

vi.mock("@anaconda-agentic-desktop/sdk-react", () => ({
	useSdk: () => ({ ports: { open: vi.fn() } }),
}));

import {
	NotebookView,
	notebookOriginFrom,
	nteractSrcFor,
	type NotebookViewProps,
} from "./NotebookView.js";

const DEFAULT_PROPS: NotebookViewProps = {
	sessionId: "session-1",
	instanceId: "instance-1",
	title: "Notebook 1",
};

function renderView(viewProps: Partial<NotebookViewProps> = {}) {
	return render(<NotebookView {...DEFAULT_PROPS} {...viewProps} />);
}

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
});

describe("NotebookView", () => {
	it("derives the notebook origin by substituting the host on our own", () => {
		// The renderer cannot read app.isPackaged, so the scheme has to come from its
		// own origin — otherwise a dev build would frame the production host.
		expect(notebookOriginFrom("anaconda-agentic-desktop://app")).toBe(
			"anaconda-agentic-desktop://notebook",
		);
		expect(notebookOriginFrom("anaconda-agentic-desktop-dev://app")).toBe(
			"anaconda-agentic-desktop-dev://notebook",
		);
	});

	it("has no notebook origin in browser mode, where the protocol does not exist", () => {
		expect(notebookOriginFrom("http://localhost:5173")).toBeUndefined();
		expect(notebookOriginFrom("https://anaconda.com")).toBeUndefined();
		expect(notebookOriginFrom("not a url")).toBeUndefined();
	});

	it("selects the Electron host and exact parent origin under the desktop scheme", () => {
		const src = nteractSrcFor("669d39ec-39d6-4160-815c-b46e170cde8d", {
			protocol: "anaconda-agentic-desktop:",
			host: "app",
		});
		const url = new URL(src!);

		expect(`${url.protocol}//${url.host}`).toBe("anaconda-agentic-desktop://notebook");
		expect(url.searchParams.get("notebook_id")).toBe("669d39ec-39d6-4160-815c-b46e170cde8d");
		expect(url.searchParams.get("nteract-host")).toBe("electron");
		expect(url.searchParams.get("nteract-parent-origin")).toBe("anaconda-agentic-desktop://app");
	});

	it("shows a placeholder while nteract's bundle is not served from our protocol", async () => {
		renderView();

		await expect.element(page.getByTestId("notebook-placeholder")).toBeVisible();
		expect(document.querySelector('[data-qa-id="notebook-frame"]')).toBeNull();
	});

	it("frames nteract's dev server when an origin is configured", () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView();

		const frame = document.querySelector('[data-qa-id="notebook-frame"]');
		expect(document.querySelector('[data-qa-id="notebook-title"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="notebook-status"]')).toBeNull();
		// The stable tab instance id becomes nteract's ephemeral notebook id.
		expect(frame?.getAttribute("src")).toBe("http://localhost:8737/?notebook_id=instance-1");
		expect(document.querySelector('[data-qa-id="notebook-placeholder"]')).toBeNull();
	});

	it("uses distinct right-panel instance ids for distinct scratch notebooks", () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView({ instanceId: "instance-2", title: "Notebook 2" });

		expect(document.querySelector('[data-qa-id="notebook-frame"]')?.getAttribute("src")).toBe(
			"http://localhost:8737/?notebook_id=instance-2",
		);
	});

	it("strips a legacy notebook.notebook: prefix before framing nteract", () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView({ instanceId: "notebook.notebook:legacy-uuid" });

		expect(document.querySelector('[data-qa-id="notebook-frame"]')?.getAttribute("src")).toBe(
			"http://localhost:8737/?notebook_id=legacy-uuid",
		);
	});
});
