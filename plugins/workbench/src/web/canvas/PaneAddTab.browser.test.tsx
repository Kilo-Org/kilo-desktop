import { cleanup, render } from "@testing-library/react";
import { NotebookIcon, TerminalIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { PaneAddTab } from "./PaneAddTab";
import type { CanvasPaneKind } from "./types";

const notebook: CanvasPaneKind = {
	id: "notebook.notebook",
	title: "Notebook",
	description: "Analyze data with interactive Python notebooks.",
	Icon: NotebookIcon,
	addable: true,
	keepAlive: true,
};

const terminal: CanvasPaneKind = {
	id: "terminal.terminal",
	title: "Terminal",
	description: "Run commands.",
	Icon: TerminalIcon,
	addable: true,
	keepAlive: true,
};

const hidden: CanvasPaneKind = {
	id: "hidden.hidden",
	title: "Hidden",
	Icon: TerminalIcon,
	addable: false,
	keepAlive: false,
};

const unavailableNotebook: CanvasPaneKind = {
	...notebook,
	unavailableHint: "Sign in to Kilo to use embedded notebooks.",
};

function renderMenu(kinds: readonly CanvasPaneKind[]) {
	const onLaunch = vi.fn();
	render(<PaneAddTab kinds={kinds} onLaunch={onLaunch} placement="toolbar" />);
	return { onLaunch };
}

afterEach(cleanup);

describe("PaneAddTab", () => {
	it("greys out an unavailable kind", async () => {
		const { onLaunch } = renderMenu([unavailableNotebook, terminal]);
		await page.getByTestId("chat-pane-toolbar-add").click();

		const item = page.getByTestId("chat-pane-launch-notebook.notebook");
		await expect.element(item).toHaveAttribute("aria-disabled", "true");
		await item.click({ force: true });
		expect(onLaunch).not.toHaveBeenCalled();

		await page.getByTestId("chat-pane-launch-terminal.terminal").click();
		expect(onLaunch).toHaveBeenCalledExactlyOnceWith(terminal);
	});

	it("says why a greyed-out kind is unavailable", async () => {
		renderMenu([unavailableNotebook, terminal]);
		await page.getByTestId("chat-pane-toolbar-add").click();

		await page.getByTestId("chat-pane-launch-notebook.notebook-unavailable").hover();

		await expect
			.element(page.getByText("Sign in to Kilo to use embedded notebooks."))
			.toBeVisible();
	});

	it("offers available kinds and omits ones that are not addable", async () => {
		const { onLaunch } = renderMenu([notebook, hidden]);
		await page.getByTestId("chat-pane-toolbar-add").click();

		await expect
			.element(page.getByTestId("chat-pane-launch-notebook.notebook-unavailable"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("chat-pane-launch-hidden.hidden"))
			.not.toBeInTheDocument();
		await page.getByTestId("chat-pane-launch-notebook.notebook").click();
		expect(onLaunch).toHaveBeenCalledExactlyOnceWith(notebook);
	});
});
