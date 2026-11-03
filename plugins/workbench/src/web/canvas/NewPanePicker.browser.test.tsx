import { cleanup, render } from "@testing-library/react";
import { NotebookIcon, TerminalIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { NewPanePicker } from "./NewPanePicker";
import type { CanvasPaneKind } from "./types";

const terminal: CanvasPaneKind = {
	id: "kilo.terminal/terminal",
	title: "Terminal",
	Icon: TerminalIcon,
	addable: true,
	keepAlive: true,
};

const notebook: CanvasPaneKind = {
	id: "kilo.notebook/notebook",
	title: "Notebook",
	Icon: NotebookIcon,
	addable: true,
	keepAlive: true,
	unavailableHint: "Sign in to use notebooks",
};

const internal: CanvasPaneKind = {
	id: "kilo.internal/internal",
	title: "Internal",
	Icon: TerminalIcon,
	addable: false,
	keepAlive: false,
};

function renderPicker() {
	const onLaunch = vi.fn();
	const onOpenChange = vi.fn();
	render(
		<NewPanePicker
			open
			onOpenChange={onOpenChange}
			title="New tab"
			kinds={[terminal, notebook, internal]}
			onLaunch={onLaunch}
		/>,
	);
	return { onLaunch, onOpenChange };
}

afterEach(cleanup);

describe("NewPanePicker", () => {
	it("launches the first addable kind on Enter and closes", async () => {
		const { onLaunch, onOpenChange } = renderPicker();
		await expect.element(page.getByTestId("new-pane-picker")).toBeVisible();

		await userEvent.keyboard("{Enter}");

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onLaunch).toHaveBeenCalledExactlyOnceWith(terminal);
	});

	it("lists unavailable kinds disabled with their hint and omits non-addable kinds", async () => {
		const { onLaunch } = renderPicker();
		const item = page.getByTestId("new-pane-picker-kilo.notebook/notebook");

		await expect.element(item).toHaveAttribute("aria-disabled", "true");
		await expect.element(item.getByText("Sign in to use notebooks")).toBeVisible();
		await expect
			.element(page.getByTestId("new-pane-picker-kilo.internal/internal"))
			.not.toBeInTheDocument();
		await item.click({ force: true });
		expect(onLaunch).not.toHaveBeenCalled();
	});
});
