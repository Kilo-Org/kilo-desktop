import { cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { FindScope } from "@kilo-desktop/ui/components/find-bar";

afterEach(() => {
	cleanup();
	window.getSelection()?.removeAllRanges();
});

// Mirrors the chat transcript's find scope: the searchable subtree is the
// message group, and a focusable probe sits inside the scope but outside it.
function Transcript({ text }: { text: string }) {
	return (
		<FindScope
			searchRootSelector='[data-slot="aui_message-group"]'
			qaPrefix="chat-find"
			placeholder="Find in transcript"
		>
			<div data-slot="aui_thread-viewport">
				<div data-slot="aui_thread-column">
					<div data-slot="aui_message-group">
						<p>{text}</p>
					</div>
				</div>
			</div>
			<button type="button" data-qa-id="focus-probe">
				probe
			</button>
		</FindScope>
	);
}

// A transcript tall enough to scroll, with one match at each end, so tests can
// observe whether the find bar moves the scroll position.
function ScrollingTranscript({ tail }: { tail?: string }) {
	return (
		<FindScope searchRootSelector='[data-slot="aui_message-group"]' qaPrefix="chat-find">
			<div data-qa-id="scroller" style={{ height: "100px", overflowY: "auto" }}>
				<div data-slot="aui_message-group">
					<p>needle at the top</p>
					{Array.from({ length: 40 }, (_, index) => (
						<p key={index}>filler line {index}</p>
					))}
					<p data-qa-id="bottom-match">needle at the bottom</p>
					{tail ? <p>{tail}</p> : null}
				</div>
			</div>
		</FindScope>
	);
}

const IS_MAC = navigator.platform.startsWith("Mac");
const FIND_MODIFIER = IS_MAC ? "metaKey" : "ctrlKey";

function findChord(init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key: "f",
		code: "KeyF",
		[FIND_MODIFIER]: true,
		bubbles: true,
		cancelable: true,
		...init,
	});
}

function pressFindChord() {
	window.dispatchEvent(findChord());
}

function count(baseElement: HTMLElement): string | undefined {
	return baseElement.querySelector('[data-qa-id="chat-find-count"]')?.textContent ?? undefined;
}

async function waitForCount(baseElement: HTMLElement, expected: string): Promise<void> {
	await vi.waitFor(() => expect(count(baseElement)).toBe(expected));
}

describe("FindBar", () => {
	it("opens on the find chord, searches, and reports a match count", async () => {
		const { baseElement } = render(<Transcript text="hello world, hello again" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await expect.element(screen.getByTestId("chat-find-bar")).toBeVisible();
		await expect.element(screen.getByTestId("chat-find-input")).toHaveFocus();

		await screen.getByTestId("chat-find-input").fill("hello");
		await waitForCount(baseElement, "1/2");
	});

	it("navigates matches with Enter / Shift+Enter and wraps around", async () => {
		const { baseElement } = render(<Transcript text="hello hello hello" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("hello");
		await waitForCount(baseElement, "1/3");

		const input = baseElement.querySelector('[data-qa-id="chat-find-input"]') as HTMLInputElement;
		fireEvent.keyDown(input, { key: "Enter" });
		await waitForCount(baseElement, "2/3");
		fireEvent.keyDown(input, { key: "Enter" });
		await waitForCount(baseElement, "3/3");
		fireEvent.keyDown(input, { key: "Enter" });
		await waitForCount(baseElement, "1/3");
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		await waitForCount(baseElement, "3/3");
	});

	it("recomputes matches when the case-sensitive toggle changes", async () => {
		const { baseElement } = render(<Transcript text="hello Hello" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("hello");
		await waitForCount(baseElement, "1/2");

		await screen.getByTestId("chat-find-case").click();
		await waitForCount(baseElement, "1/1");
	});

	it("closes and clears highlights on Escape", async () => {
		const { baseElement } = render(<Transcript text="hello world" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("hello");
		await waitForCount(baseElement, "1/1");
		expect(CSS.highlights.has("kilo-find-active")).toBe(true);

		const input = baseElement.querySelector('[data-qa-id="chat-find-input"]') as HTMLInputElement;
		fireEvent.keyDown(input, { key: "Escape" });

		await expect.element(screen.getByTestId("chat-find-bar")).not.toBeInTheDocument();
		expect(CSS.highlights.has("kilo-find")).toBe(false);
		expect(CSS.highlights.has("kilo-find-active")).toBe(false);
	});

	it("keeps a single find session open across panes", async () => {
		const { baseElement } = render(
			<>
				<Transcript text="alpha one" />
				<Transcript text="beta two" />
			</>,
		);
		const bars = () => baseElement.querySelectorAll('[data-qa-id="chat-find-bar"]');

		const [firstProbe, secondProbe] = Array.from(
			baseElement.querySelectorAll<HTMLButtonElement>('[data-qa-id="focus-probe"]'),
		);
		firstProbe?.focus();
		pressFindChord();
		await vi.waitFor(() => expect(bars()).toHaveLength(1));

		secondProbe?.focus();
		pressFindChord();
		await vi.waitFor(() => expect(bars()).toHaveLength(1));
	});

	it("ignores the chord when focus is outside any find scope (native-search panes)", async () => {
		// A find scope sitting in an inactive pane, plus a focusable surface in the
		// active pane that owns its own search (e.g. the files code editor).
		const { baseElement } = render(
			<>
				<div data-pane-active="true">
					<textarea data-qa-id="editor-surface" defaultValue="hello world" />
				</div>
				<div>
					<Transcript text="hello world" />
				</div>
			</>,
		);
		const editor = baseElement.querySelector(
			'[data-qa-id="editor-surface"]',
		) as HTMLTextAreaElement;
		editor.focus();

		const event = findChord();
		window.dispatchEvent(event);

		// The bar only calls preventDefault when it opens, so an untouched event
		// means it stayed closed and the focused pane's own search gets the chord.
		expect(event.defaultPrevented).toBe(false);
	});

	it("does not pull the scroll position back when the transcript changes (streaming)", async () => {
		const { baseElement, rerender } = render(<ScrollingTranscript />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("needle");
		await waitForCount(baseElement, "1/2");

		const scroller = baseElement.querySelector('[data-qa-id="scroller"]') as HTMLElement;
		scroller.scrollTop = 600;
		rerender(<ScrollingTranscript tail="a streamed needle" />);
		await waitForCount(baseElement, "1/3");

		expect(scroller.scrollTop).toBe(600);
	});

	it("keeps the count current while content streams in continuously", async () => {
		const { baseElement } = render(<Transcript text="needle" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("needle");
		await waitForCount(baseElement, "1/1");

		// Tokens arrive faster than the recompute debounce, as in a streaming reply.
		const group = baseElement.querySelector('[data-slot="aui_message-group"]') as HTMLElement;
		const stream = window.setInterval(() => {
			const token = document.createElement("span");
			token.textContent = " needle";
			group.append(token);
		}, 30);
		try {
			await vi.waitFor(() => expect(count(baseElement)).not.toBe("1/1"), { timeout: 1000 });
		} finally {
			window.clearInterval(stream);
		}
	});

	it("reveals the next match inside its scroll container", async () => {
		const { baseElement } = render(<ScrollingTranscript />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("needle");
		await waitForCount(baseElement, "1/2");

		const input = baseElement.querySelector('[data-qa-id="chat-find-input"]') as HTMLInputElement;
		fireEvent.keyDown(input, { key: "Enter" });
		await waitForCount(baseElement, "2/2");

		const scroller = baseElement.querySelector('[data-qa-id="scroller"]') as HTMLElement;
		const match = baseElement.querySelector('[data-qa-id="bottom-match"]') as HTMLElement;
		await vi.waitFor(() => {
			const box = scroller.getBoundingClientRect();
			const rect = match.getBoundingClientRect();
			expect(rect.top).toBeGreaterThanOrEqual(box.top);
			expect(rect.bottom).toBeLessThanOrEqual(box.bottom);
		});
	});

	it("keeps the open session's highlights when another pane's bar unmounts", async () => {
		function Panes({ showSecond }: { showSecond: boolean }) {
			return (
				<>
					<Transcript text="alpha one" />
					{showSecond ? <Transcript text="beta two" /> : null}
				</>
			);
		}
		const { baseElement, rerender } = render(<Panes showSecond />);
		const screen = page.elementLocator(baseElement);

		baseElement.querySelector<HTMLButtonElement>('[data-qa-id="focus-probe"]')?.focus();
		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("alpha");
		await waitForCount(baseElement, "1/1");
		await vi.waitFor(() => expect(CSS.highlights.has("kilo-find-active")).toBe(true));

		rerender(<Panes showSecond={false} />);

		expect(CSS.highlights.has("kilo-find-active")).toBe(true);
	});

	it("refocuses and selects the query when the chord is pressed while open", async () => {
		const { baseElement } = render(<Transcript text="hello world" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("hello");
		await waitForCount(baseElement, "1/1");

		baseElement.querySelector<HTMLButtonElement>('[data-qa-id="focus-probe"]')?.focus();
		pressFindChord();

		const input = baseElement.querySelector('[data-qa-id="chat-find-input"]') as HTMLInputElement;
		await expect.element(screen.getByTestId("chat-find-input")).toHaveFocus();
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, "hello".length]);
	});

	it("opens the shown tab's bar, never a parked tab's, in the active pane", async () => {
		// A pane group keeps every tab mounted; parked tabs are hidden but still
		// inside the active pane. The parked one mounts last so it would win a race.
		const { baseElement } = render(
			<div data-pane-active="true">
				<FindScope qaPrefix="chat-find">
					<p>shown tab</p>
				</FindScope>
				<div hidden>
					<FindScope qaPrefix="plan-find">
						<p>parked tab</p>
					</FindScope>
				</div>
			</div>,
		);
		const screen = page.elementLocator(baseElement);

		pressFindChord();

		await expect.element(screen.getByTestId("chat-find-bar")).toBeVisible();
		expect(baseElement.querySelector('[data-qa-id="plan-find-bar"]')).toBeNull();
	});

	it("ignores the other platform's modifier (Ctrl+F moves the caret on macOS)", async () => {
		render(<Transcript text="hello world" />);
		const otherModifier = IS_MAC
			? { metaKey: false, ctrlKey: true }
			: { ctrlKey: false, metaKey: true };

		const event = findChord(otherModifier);
		window.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});

	it("opens on a non-Latin keyboard layout via the physical F key", async () => {
		const { baseElement } = render(<Transcript text="hello world" />);
		const screen = page.elementLocator(baseElement);

		window.dispatchEvent(findChord({ key: "а" }));

		await expect.element(screen.getByTestId("chat-find-bar")).toBeVisible();
	});

	it("is inert while disabled, leaving the chord to the rest of the app", async () => {
		const { baseElement } = render(
			<FindScope enabled={false} qaPrefix="chat-find">
				<p>hello world</p>
			</FindScope>,
		);

		const event = findChord();
		window.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
		expect(baseElement.querySelector("[data-find-scope]")).toBeNull();
		expect(baseElement.textContent?.trim()).toBe("hello world");
	});

	it("keeps the pane content mounted when the flag flips at runtime", async () => {
		const mounts = vi.fn();
		function PaneContent() {
			useEffect(mounts, []);
			return <p>hello world</p>;
		}
		const { rerender } = render(
			<FindScope enabled={false} qaPrefix="chat-find">
				<PaneContent />
			</FindScope>,
		);

		rerender(
			<FindScope enabled qaPrefix="chat-find">
				<PaneContent />
			</FindScope>,
		);
		rerender(
			<FindScope enabled={false} qaPrefix="chat-find">
				<PaneContent />
			</FindScope>,
		);

		expect(mounts).toHaveBeenCalledTimes(1);
	});

	it("never matches its own controls when the whole scope is searched", async () => {
		const { baseElement } = render(
			<FindScope qaPrefix="chat-find">
				<p>aardvark</p>
			</FindScope>,
		);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		// "Aa" is also the label of the bar's own match-case toggle.
		await screen.getByTestId("chat-find-input").fill("aa");

		await waitForCount(baseElement, "1/1");
	});

	it("announces the match position to assistive technology", async () => {
		const { baseElement } = render(<Transcript text="hello world, hello again" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("hello");
		await expect.element(screen.getByRole("status")).toHaveTextContent("Match 1 of 2");

		await screen.getByTestId("chat-find-input").fill("zzz");
		await expect.element(screen.getByRole("status")).toHaveTextContent("No matches");
	});

	it("reopens with the previous query selected and searched", async () => {
		const { baseElement } = render(<Transcript text="hello world" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("hello");
		await waitForCount(baseElement, "1/1");
		const input = () =>
			baseElement.querySelector('[data-qa-id="chat-find-input"]') as HTMLInputElement;
		fireEvent.keyDown(input(), { key: "Escape" });
		await expect.element(screen.getByTestId("chat-find-bar")).not.toBeInTheDocument();

		pressFindChord();

		await waitForCount(baseElement, "1/1");
		expect(input().value).toBe("hello");
		expect([input().selectionStart, input().selectionEnd]).toEqual([0, "hello".length]);
	});

	it("seeds the query from selected transcript text, starting at that occurrence", async () => {
		const { baseElement } = render(<Transcript text="beta alpha beta" />);
		const text = baseElement.querySelector('[data-slot="aui_message-group"] p')?.firstChild;
		const selection = new Range();
		selection.setStart(text as Text, "beta alpha ".length);
		selection.setEnd(text as Text, "beta alpha beta".length);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(selection);

		pressFindChord();

		await waitForCount(baseElement, "2/2");
		const input = baseElement.querySelector('[data-qa-id="chat-find-input"]') as HTMLInputElement;
		expect(input.value).toBe("beta");
	});

	it("moves to a newly selected occurrence when the chord is pressed while open", async () => {
		const { baseElement } = render(<Transcript text="beta alpha beta" />);
		const screen = page.elementLocator(baseElement);
		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("beta");
		await waitForCount(baseElement, "1/2");

		const text = baseElement.querySelector('[data-slot="aui_message-group"] p')?.firstChild;
		const selection = new Range();
		selection.setStart(text as Text, "beta alpha ".length);
		selection.setEnd(text as Text, "beta alpha beta".length);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(selection);
		pressFindChord();

		await waitForCount(baseElement, "2/2");
	});

	it("shows 0/0 for a query with no matches", async () => {
		const { baseElement } = render(<Transcript text="hello world" />);
		const screen = page.elementLocator(baseElement);

		pressFindChord();
		await screen.getByTestId("chat-find-input").fill("zzz");
		await waitForCount(baseElement, "0/0");
	});
});
