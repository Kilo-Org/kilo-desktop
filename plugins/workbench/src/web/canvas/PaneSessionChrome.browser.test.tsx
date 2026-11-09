import { cleanup, render } from "@testing-library/react";
import { TerminalIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { PaneLaunchToolbar } from "./PaneLaunchToolbar";
import { PaneSessionChrome } from "./PaneSessionChrome";
import type { CanvasPaneKind } from "./types";

afterEach(cleanup);

describe("PaneSessionChrome", () => {
	it.each([
		["tiles", "carousel", "false"],
		["carousel", "tiles", "true"],
	] as const)("toggles from %s to %s", async (arrangement, next, pressed) => {
		const onArrangementChange = vi.fn();
		render(
			<PaneSessionChrome arrangement={arrangement} onArrangementChange={onArrangementChange} />,
		);
		const toggle = page.getByTestId("chat-pane-arrangement");

		await expect.element(toggle).toHaveAttribute("aria-pressed", pressed);
		await toggle.click();
		expect(onArrangementChange).toHaveBeenCalledExactlyOnceWith(next);
	});
});

describe("PaneLaunchToolbar", () => {
	it("launches a kind from the header add menu", async () => {
		const terminal: CanvasPaneKind = {
			id: "kilo.terminal/terminal",
			title: "Terminal",
			Icon: TerminalIcon,
			addable: true,
			keepAlive: true,
		};
		const onLaunch = vi.fn();
		render(<PaneLaunchToolbar kinds={[terminal]} onLaunch={onLaunch} />);

		await page.getByTestId("chat-pane-toolbar-add").click();
		await page.getByTestId("chat-pane-launch-kilo.terminal/terminal").click();

		expect(onLaunch).toHaveBeenCalledExactlyOnceWith(terminal);
	});
});
