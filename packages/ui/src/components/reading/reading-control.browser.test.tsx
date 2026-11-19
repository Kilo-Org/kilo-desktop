import { useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import {
	DEFAULT_READING_SETTINGS,
	normalizeReadingSettings,
	type ReadingSettings,
	type ReadingSettingsPatch,
} from "@kilo-desktop/ui/lib/reading/settings";

import { ReadingControl, type ReadingSettingName } from "./reading-control";

function Harness({
	inFocus = false,
	initialFocus = false,
	onChanged = () => {},
}: {
	inFocus?: boolean;
	initialFocus?: boolean;
	onChanged?: (setting: ReadingSettingName, settings: ReadingSettings) => void;
}) {
	const [settings, setSettings] = useState(DEFAULT_READING_SETTINGS);
	const [focusOn, setFocusOn] = useState(initialFocus);
	const change = (patch: ReadingSettingsPatch, setting: ReadingSettingName) => {
		const next = normalizeReadingSettings({
			...settings,
			...patch,
			focus: { ...settings.focus, ...patch.focus },
		});
		setSettings(next);
		onChanged(setting, next);
	};
	return (
		<div style={{ padding: "400px 0 0 320px" }}>
			<ReadingControl
				settings={settings}
				onChange={change}
				onReset={() => setSettings(DEFAULT_READING_SETTINGS)}
				appTheme={{ themeId: "kilo", mode: "dark" }}
				baseSize={14}
				inFocus={inFocus}
				focusOn={focusOn}
				onFocusChange={setFocusOn}
				focusShortcut="⌘⇧F"
				footnote="Works in the chat. Esc turns it off."
			/>
		</div>
	);
}

afterEach(cleanup);

describe("ReadingControl", () => {
	it("opens above its Aa button, pressed while open, with the reading settings", async () => {
		render(<Harness />);
		const trigger = page.getByTestId("reading-trigger");

		await trigger.click();

		const popover = page.getByTestId("reading-popover");
		await expect.element(popover).toBeVisible();
		await expect.element(trigger).toHaveAttribute("data-popup-open");
		await expect.element(popover.getByText("Reading", { exact: true })).toBeVisible();
		await expect.element(page.getByTestId("reading-theme-name")).toHaveTextContent("Kilo");
		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("14px");
		await expect.element(page.getByTestId("reading-theme-hint")).not.toBeInTheDocument();
		expect(page.getByRole("radio", { name: /./ }).elements().length).toBeGreaterThan(8);
		// Measured once the open animation has settled.
		await expect.poll(() => Math.round(popover.element().getBoundingClientRect().width)).toBe(304);
		const popoverBox = popover.element().getBoundingClientRect();
		const triggerBox = trigger.element().getBoundingClientRect();
		expect(popoverBox.bottom).toBeLessThanOrEqual(triggerBox.top);
		expect(Math.abs(popoverBox.right - triggerBox.right)).toBeLessThan(1);
	});

	it("changes theme, mode, text size and spacing, and resets", async () => {
		const changes: ReadingSettingName[] = [];
		render(<Harness onChanged={(setting) => changes.push(setting)} />);
		await page.getByTestId("reading-trigger").click();

		await page.getByRole("radio", { name: "Gruvbox" }).click();
		await page.getByTestId("reading-mode-light").click();
		await page.getByRole("button", { name: "Larger text" }).click();
		await page.getByRole("button", { name: "Larger text" }).click();
		await page.getByRole("radio", { name: "Loosest" }).click();

		await expect.element(page.getByTestId("reading-theme-name")).toHaveTextContent("Gruvbox");
		await expect
			.element(page.getByRole("radio", { name: "Gruvbox" }))
			.toHaveAttribute("aria-checked", "true");
		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("16px");
		expect(changes).toEqual(["theme", "mode", "text-size", "text-size", "line-spacing"]);

		await page.getByTestId("reading-reset").click();
		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("14px");
		await expect.element(page.getByTestId("reading-theme-name")).toHaveTextContent("Kilo");
	});

	it("stops the text size at its limits", async () => {
		render(<Harness />);
		await page.getByTestId("reading-trigger").click();
		const smaller = page.getByRole("button", { name: "Smaller text" });

		await smaller.click();
		await smaller.click();

		await expect.element(page.getByTestId("reading-size")).toHaveTextContent("12px");
		await expect.element(smaller).toBeDisabled();
	});

	it("shows Focus options and the footnote only while Focus is on", async () => {
		render(<Harness inFocus />);
		await page.getByTestId("reading-trigger").click();
		await expect.element(page.getByTestId("reading-focus-options")).not.toBeInTheDocument();

		await page.getByRole("switch", { name: "Focus" }).click();

		await expect.element(page.getByTestId("reading-focus-options")).toBeVisible();
		await expect.element(page.getByTestId("reading-dimming-value")).toHaveTextContent("60%");
		await expect
			.element(page.getByTestId("reading-footnote"))
			.toHaveTextContent("Works in the chat. Esc turns it off.");
		const popover = page.getByTestId("reading-popover").element().getBoundingClientRect();
		const group = page.getByTestId("reading-moves-with").element().getBoundingClientRect();
		expect(group.right).toBeLessThanOrEqual(popover.right - 14 + 0.5);
		for (const option of ["scroll", "pointer", "keys"]) {
			const button = page.getByTestId(`reading-moves-with-${option}`).element() as HTMLElement;
			expect(button.getBoundingClientRect().height).toBe(24);
			expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
			const line = Number.parseFloat(getComputedStyle(button).lineHeight);
			const range = document.createRange();
			range.selectNodeContents(button);
			expect(range.getBoundingClientRect().height).toBeLessThanOrEqual(Math.max(line, 16) + 1);
		}
		await page.getByTestId("reading-moves-with-keys").click();
		await expect
			.element(page.getByTestId("reading-moves-with-keys"))
			.toHaveAttribute("aria-checked", "true");
	});
});
