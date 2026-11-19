import { useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { readingThemeStyle } from "@kilo-desktop/ui/lib/reading/reading-theme";
import {
	DEFAULT_READING_SETTINGS,
	type FocusMovesWith,
} from "@kilo-desktop/ui/lib/reading/settings";
import { readingTypography } from "@kilo-desktop/ui/lib/reading/typography";
import { useDimmingPreview } from "@kilo-desktop/ui/lib/reading/use-dimming-preview";

import { useFocusLayer } from "./focus-context";
import { FocusReader, type FocusExitRequest, type FocusVisitSummary } from "./focus-reader";
import { ReadingControl } from "./reading-control";

const PARAGRAPHS = Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1}.`);

function Reader({
	initialBlock = 0,
	movesWith = "scroll",
	paragraphs = PARAGRAPHS,
	onExit = () => {},
	onVisitEnd,
	themeId = "kilo",
	scheme = "dark",
}: {
	initialBlock?: number;
	movesWith?: FocusMovesWith;
	paragraphs?: readonly string[];
	onExit?: (request: FocusExitRequest) => void;
	onVisitEnd?: (summary: FocusVisitSummary) => void;
	themeId?: string;
	scheme?: "light" | "dark";
}) {
	return (
		<div style={{ position: "fixed", inset: 0 }}>
			<FocusReader
				theme={readingThemeStyle(themeId, scheme)}
				scheme={scheme}
				typography={readingTypography("focus", DEFAULT_READING_SETTINGS)}
				dimming={60}
				movesWith={movesWith}
				initialBlock={initialBlock}
				onExit={onExit}
				{...(onVisitEnd ? { onVisitEnd } : {})}
			>
				<div className="aui-md">
					{paragraphs.map((text) => (
						<p key={text}>{text}</p>
					))}
				</div>
			</FocusReader>
		</div>
	);
}

const opacity = (text: string) => page.getByText(text).element() as HTMLElement;

afterEach(cleanup);

describe("FocusReader", () => {
	it("shows the focused block at full colour and fades the rest by distance", async () => {
		render(<Reader initialBlock={3} />);

		await expect.element(page.getByText("Paragraph 4.")).toBeVisible();
		await expect.poll(() => opacity("Paragraph 4.").style.opacity).toBe("");
		expect(opacity("Paragraph 3.").style.opacity).toBe("0.3");
		expect(opacity("Paragraph 5.").style.opacity).toBe("0.3");
		expect(opacity("Paragraph 6.").style.opacity).toBe("0.22");
		expect(opacity("Paragraph 8.").style.opacity).toBe("0.14");
		await expect
			.element(page.getByTestId("focus-hint"))
			.toHaveTextContent("↑ ↓ to move between paragraphs");
	});

	it("moves between blocks with ↑ ↓ and stops at the ends", async () => {
		render(<Reader initialBlock={0} movesWith="keys" />);
		await expect.poll(() => opacity("Paragraph 1.").style.opacity).toBe("");

		await userEvent.keyboard("{ArrowUp}");
		await userEvent.keyboard("{ArrowDown}");
		await userEvent.keyboard("{ArrowDown}");

		await expect.poll(() => opacity("Paragraph 3.").style.opacity).toBe("");
		expect(opacity("Paragraph 1.").style.opacity).toBe("0.22");
	});

	it("uses the reading theme for the whole reader, with dimming from its own text colour", async () => {
		render(<Reader themeId="gruvbox" scheme="light" initialBlock={1} />);
		const root = page.getByTestId("focus-reader").element() as HTMLElement;

		await expect.poll(() => getComputedStyle(root).backgroundColor).toBe("rgb(251, 241, 199)");
		expect(getComputedStyle(root).color).toBe("rgb(60, 56, 54)");
		expect(root.dataset.theme).toBe("light");
		await expect.poll(() => opacity("Paragraph 1.").style.opacity).toBe("0.34");
	});

	it("exits on Esc and from the Exit focus pill", async () => {
		const exits: FocusExitRequest[] = [];
		render(<Reader onExit={(request) => exits.push(request)} />);
		await expect.element(page.getByTestId("focus-exit")).toHaveAccessibleName("Exit focus");

		await userEvent.keyboard("{Escape}");
		await page.getByTestId("focus-exit").click();

		expect(exits).toEqual(["escape", "exit-button"]);
	});

	it("keeps focus on the same block when content grows, and reports the visit at the end", async () => {
		const summaries: FocusVisitSummary[] = [];
		function Growing() {
			const [paragraphs, setParagraphs] = useState(PARAGRAPHS.slice(0, 3));
			return (
				<>
					<button
						type="button"
						style={{ position: "fixed", top: 0, left: 0, zIndex: 100 }}
						onClick={() => setParagraphs((list) => ["Intro.", ...list, "More."])}
					>
						grow
					</button>
					<Reader
						paragraphs={paragraphs}
						initialBlock={1}
						movesWith="keys"
						onVisitEnd={(s) => summaries.push(s)}
					/>
				</>
			);
		}
		const view = render(<Growing />);
		await expect.poll(() => opacity("Paragraph 2.").style.opacity).toBe("");

		await page.getByRole("button", { name: "grow" }).click();

		await expect.element(page.getByText("More.")).toBeInTheDocument();
		await expect.poll(() => opacity("Intro.").style.opacity).toBe("0.22");
		expect(opacity("Paragraph 2.").style.opacity).toBe("");
		await userEvent.keyboard("{ArrowDown}");
		view.unmount();

		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toMatchObject({ blockCount: 5, movesByKeys: 1, blocksVisited: 2 });
	});

	it("follows the pointer in pointer mode, and the column's middle while scrolling", async () => {
		const view = render(<Reader initialBlock={0} movesWith="pointer" />);
		await expect.poll(() => opacity("Paragraph 1.").style.opacity).toBe("");

		await page.getByText("Paragraph 2.").hover();
		await expect.poll(() => opacity("Paragraph 2.").style.opacity).toBe("");

		view.unmount();
		render(<Reader initialBlock={0} movesWith="scroll" />);
		await expect.poll(() => opacity("Paragraph 1.").style.opacity).toBe("");
		await new Promise((resolve) => setTimeout(resolve, 500));
		const scroller = page.getByTestId("focus-reader-scroller").element();
		const target = page.getByText("Paragraph 6.").element().getBoundingClientRect();
		const box = scroller.getBoundingClientRect();
		scroller.scrollTop += (target.top + target.bottom) / 2 - (box.top + box.height / 2);

		await expect.poll(() => opacity("Paragraph 6.").style.opacity).toBe("");
	});

	it("sets only the reading column at the reading size, and opens its Aa menu in the app's theme and size", async () => {
		const settings = { ...DEFAULT_READING_SETTINGS, textSizeStep: 4 };
		render(
			<div style={{ position: "fixed", inset: 0 }}>
				<FocusReader
					theme={readingThemeStyle("gruvbox", "light")}
					scheme="light"
					typography={readingTypography("focus", settings)}
					dimming={60}
					movesWith="scroll"
					initialBlock={0}
					onExit={() => {}}
					control={
						<ReadingControl
							settings={settings}
							onChange={() => {}}
							onReset={() => {}}
							appTheme={{ themeId: "kilo", mode: "dark" }}
							baseSize={16}
							inFocus
							focusOn
							onFocusChange={() => {}}
							footnote="Esc turns it off."
						/>
					}
				>
					<div className="aui-md">
						<p>Read me.</p>
					</div>
				</FocusReader>
			</div>,
		);
		const app = getComputedStyle(document.documentElement);
		const textSize = (element: Element) =>
			getComputedStyle(element).getPropertyValue("--app-ui-text-size");

		expect(textSize(page.getByText("Read me.").element())).toBe("20px");
		expect(textSize(page.getByTestId("focus-exit").element())).toBe(
			app.getPropertyValue("--app-ui-text-size"),
		);

		await page.getByTestId("reading-trigger").click();
		const popover = page.getByTestId("reading-popover").element();
		await expect.element(popover).toBeVisible();
		expect(page.getByTestId("focus-reader").element().contains(popover)).toBe(false);
		expect(textSize(popover)).toBe(app.getPropertyValue("--app-ui-text-size"));
		expect(getComputedStyle(popover).getPropertyValue("--popover")).toBe(
			app.getPropertyValue("--popover"),
		);
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("reading-popover")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("focus-reader")).toBeInTheDocument();
	});

	it("closes a preset dialog, then the Aa menu, then Focus, one Escape at a time", async () => {
		const exits: FocusExitRequest[] = [];
		const done = async () => {};
		render(
			<div style={{ position: "fixed", inset: 0 }}>
				<FocusReader
					theme={readingThemeStyle("kilo", "dark")}
					scheme="dark"
					typography={readingTypography("focus", DEFAULT_READING_SETTINGS)}
					dimming={60}
					movesWith="scroll"
					initialBlock={0}
					onExit={(request) => exits.push(request)}
					control={
						<ReadingControl
							settings={DEFAULT_READING_SETTINGS}
							onChange={() => {}}
							onReset={() => {}}
							appTheme={{ themeId: "kilo", mode: "dark" }}
							baseSize={16}
							inFocus
							focusOn
							onFocusChange={() => {}}
							footnote=""
							presets={{
								state: {
									presets: [{ id: "a", name: "Late night", settings: DEFAULT_READING_SETTINGS }],
									activeId: "a",
									defaultId: null,
								},
								unsaved: false,
								apply: done,
								save: done,
								update: done,
								rename: done,
								remove: done,
								setDefault: done,
							}}
						/>
					}
				>
					<div className="aui-md">
						<p>Read me.</p>
					</div>
				</FocusReader>
			</div>,
		);
		await page.getByTestId("reading-trigger").click();
		await page.getByTestId("reading-presets-trigger").click();
		await page.getByTestId("reading-preset-manage").click();
		const dialog = page.getByTestId("reading-preset-manage-dialog");
		await expect.element(dialog).toBeVisible();
		expect(page.getByTestId("focus-reader").element().contains(dialog.element())).toBe(false);

		await userEvent.keyboard("{Escape}");
		await expect.element(dialog).not.toBeInTheDocument();
		await expect.element(page.getByTestId("reading-popover")).toBeVisible();
		expect(exits).toEqual([]);

		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("reading-popover")).not.toBeInTheDocument();
		expect(exits).toEqual([]);

		await userEvent.keyboard("{Escape}");
		expect(exits).toEqual(["escape"]);
	});

	it("re-dims while the Dimming slider is dragged, and saves the value on release", async () => {
		const saved: number[] = [];
		function DimmingReader() {
			const [settings, setSettings] = useState(DEFAULT_READING_SETTINGS);
			const { dimming, onDimmingInput } = useDimmingPreview(settings.focus.dimming);
			return (
				<div style={{ position: "fixed", inset: 0 }}>
					<FocusReader
						theme={readingThemeStyle("kilo", "dark")}
						scheme="dark"
						typography={readingTypography("focus", settings)}
						dimming={dimming}
						movesWith="keys"
						initialBlock={1}
						onExit={() => {}}
						control={
							<ReadingControl
								settings={settings}
								onChange={(patch) => {
									const next = { ...settings.focus, ...patch.focus };
									saved.push(next.dimming);
									setSettings({ ...settings, focus: next });
								}}
								onDimmingInput={onDimmingInput}
								onReset={() => {}}
								appTheme={{ themeId: "kilo", mode: "dark" }}
								baseSize={16}
								inFocus
								focusOn
								onFocusChange={() => {}}
								footnote="Esc turns it off."
							/>
						}
					>
						<div className="aui-md">
							{PARAGRAPHS.slice(0, 3).map((text) => (
								<p key={text}>{text}</p>
							))}
						</div>
					</FocusReader>
				</div>
			);
		}
		render(<DimmingReader />);
		await expect.poll(() => opacity("Paragraph 1.").style.opacity).toBe("0.3");
		await page.getByTestId("reading-trigger").click();
		const slider = page.getByTestId("reading-dimming").element();
		const control = slider.querySelector('[data-slot="slider-track"]')!.parentElement!;
		const thumb = slider.querySelector('[data-slot="slider-thumb"]')!;
		// Measured once the popover's open animation has settled.
		await expect.poll(() => Math.round(control.getBoundingClientRect().width)).toBeGreaterThan(80);
		const box = control.getBoundingClientRect();
		const thumbBox = thumb.getBoundingClientRect();
		const pointer = (x: number, buttons: number) => ({
			bubbles: true,
			pointerId: 1,
			pointerType: "mouse",
			isPrimary: true,
			button: 0,
			buttons,
			clientX: x,
			clientY: box.top + box.height / 2,
		});

		thumb.dispatchEvent(new PointerEvent("pointerdown", pointer(thumbBox.left + 6, 1)));
		document.dispatchEvent(new PointerEvent("pointermove", pointer(box.left - 20, 1)));

		await expect.poll(() => opacity("Paragraph 1.").style.opacity).toBe("");
		expect(saved).toEqual([]);

		document.dispatchEvent(new PointerEvent("pointermove", pointer(box.right + 20, 1)));
		await expect.poll(() => opacity("Paragraph 1.").style.opacity).toBe("0.12");
		expect(saved).toEqual([]);

		document.dispatchEvent(new PointerEvent("pointerup", pointer(box.right + 20, 0)));
		await expect.poll(() => saved).toEqual([100]);
		expect(opacity("Paragraph 1.").style.opacity).toBe("0.12");
	});

	it("leaves Escape to an open layer, counts typing and find attempts, and remembers copies", async () => {
		const summaries: FocusVisitSummary[] = [];
		const copies: string[] = [];
		function WithLayer() {
			return (
				<div style={{ position: "fixed", inset: 0 }}>
					<FocusReader
						theme={readingThemeStyle("kilo", "dark")}
						scheme="dark"
						typography={readingTypography("focus", DEFAULT_READING_SETTINGS)}
						dimming={60}
						movesWith="keys"
						initialBlock={0}
						onExit={() => copies.push("exit")}
						onCopy={(text) => copies.push(text)}
						onVisitEnd={(summary) => summaries.push(summary)}
						overlay={<Layer />}
					>
						<div className="aui-md">
							<p>Copy me.</p>
						</div>
					</FocusReader>
				</div>
			);
		}
		function Layer() {
			useFocusLayer(true);
			return null;
		}
		const view = render(<WithLayer />);
		await expect.element(page.getByText("Copy me.")).toBeVisible();

		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("ab");
		await userEvent.keyboard("{Control>}f{/Control}");
		const node = page.getByText("Copy me.").element().firstChild!;
		const range = document.createRange();
		range.selectNodeContents(node);
		getSelection()!.removeAllRanges();
		getSelection()!.addRange(range);
		page
			.getByTestId("focus-reader")
			.element()
			.dispatchEvent(new ClipboardEvent("copy", { bubbles: true }));
		view.unmount();

		expect(copies).toEqual(["Copy me."]);
		expect(summaries[0]).toMatchObject({ typingAttempts: 2, findAttempts: 1, copies: 1 });
	});
});
