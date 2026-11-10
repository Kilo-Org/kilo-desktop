import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";

import { BROWSER_PANE_KIND, URL_OBJECT_TYPE } from "../contracts/index.js";
import { bootBrowserHost, type BrowserHostOptions } from "../test/browser-host.js";
import { SESSION_ID } from "../test/sessions-host.js";

const WAIT = { timeout: 5_000 };

/**
 * Records whether the app handled each click, then cancels the navigation so
 * an unhandled link never navigates the test frame away.
 */
const clicks: { defaultPrevented: boolean }[] = [];
function recordClick(event: MouseEvent) {
	clicks.push({ defaultPrevented: event.defaultPrevented });
	event.preventDefault();
}
beforeEach(() => {
	clicks.length = 0;
	window.addEventListener("click", recordClick);
});
afterEach(() => {
	window.removeEventListener("click", recordClick);
});

async function renderMessage(
	text: string,
	options: BrowserHostOptions & { readonly workSessionId?: string } = {},
) {
	const host = await bootBrowserHost({ panes: [], ...options });
	host.render(
		<MarkdownContent
			text={text}
			extensions={[host.markdownExtension(options.workSessionId ?? SESSION_ID)]}
		/>,
	);
	return host;
}

describe("kilo.browser's web links", () => {
	it("opens a web link from the agent's reply in a Browser pane of its work session", async () => {
		const host = await renderMessage("See [the docs](https://example.com/docs).");

		await page.getByRole("link", { name: "the docs" }).click();

		await vi.waitFor(
			() =>
				expect(host.sessions.panes().panes).toEqual([
					expect.objectContaining({
						kind: BROWSER_PANE_KIND,
						object: { type: URL_OBJECT_TYPE, id: "https://example.com/docs" },
						metadata: {},
					}),
				]),
			WAIT,
		);
		await vi.waitFor(
			() =>
				expect(host.tracked).toEqual([
					{ event: "Browser Tab Opened", data: { source: "chat-link" } },
				]),
			WAIT,
		);
		expect(clicks).toEqual([{ defaultPrevented: true }]);
		expect(host.opened).toEqual([]);
	});

	it("opens autolinked URLs too, reusing a pane already on the page", async () => {
		const host = await renderMessage(
			"Server running at <http://localhost:5173/>, see http://localhost:5173/",
		);

		await page.getByRole("link", { name: "http://localhost:5173/" }).first().click();
		await vi.waitFor(() => expect(host.sessions.panes().panes).toHaveLength(1), WAIT);
		await page.getByRole("link", { name: "http://localhost:5173/" }).last().click();
		await vi.waitFor(() => expect(host.tracked).toHaveLength(2), WAIT);

		expect(host.sessions.panes().panes).toHaveLength(1);
	});

	it.each([
		["meta", { metaKey: true }],
		["ctrl", { ctrlKey: true }],
		["shift", { shiftKey: true }],
		["alt", { altKey: true }],
	] as const)("opens the default browser on %s-click", async (_name, modifiers) => {
		const host = await renderMessage("[docs](https://example.com)");

		page
			.getByRole("link", { name: "docs" })
			.element()
			.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }));

		await vi.waitFor(() => expect(host.opened).toEqual(["https://example.com"]), WAIT);
		expect(host.sessions.panes().panes).toEqual([]);
		expect(clicks).toEqual([{ defaultPrevented: true }]);
	});

	it("tells the reader where a web link goes and how to open it in the default browser", async () => {
		await renderMessage(
			'[docs](https://example.com/docs) and [guide](https://example.com/guide "Setup guide")',
		);

		await expect
			.element(page.getByRole("link", { name: "docs" }))
			.toHaveAttribute(
				"title",
				expect.stringMatching(
					/^https:\/\/example\.com\/docs\n(⌘|Ctrl)-click to open in your default browser$/u,
				),
			);
		await expect
			.element(page.getByRole("link", { name: "guide" }))
			.toHaveAttribute("title", expect.stringMatching(/^Setup guide\n/u));
	});

	it("leaves links that are not web pages alone", async () => {
		const host = await renderMessage("[mail us](mailto:team@example.com)");

		await page.getByRole("link", { name: "mail us" }).click();

		expect(host.sessions.panes().panes).toEqual([]);
		expect(clicks).toEqual([{ defaultPrevented: false }]);
	});

	it("leaves links alone outside a work session", async () => {
		const host = await renderMessage("[docs](https://example.com)", { workSessionId: "" });

		await page.getByRole("link", { name: "docs" }).click();

		expect(host.opened).toEqual([]);
		expect(clicks).toEqual([{ defaultPrevented: false }]);
	});

	it("opens the default browser when no pane can take the page", async () => {
		const host = await renderMessage("[docs](https://example.com)", { withoutSessions: true });

		await page.getByRole("link", { name: "docs" }).click();

		await vi.waitFor(() => expect(host.opened).toEqual(["https://example.com"]), WAIT);
		expect(clicks).toEqual([{ defaultPrevented: true }]);
		expect(host.tracked).toEqual([]);
	});
});
