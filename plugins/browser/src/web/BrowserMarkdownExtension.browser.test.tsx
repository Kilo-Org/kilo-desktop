import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";

import { BrowserMarkdownExtension } from "./BrowserMarkdownExtension.js";

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
	cleanup();
});

function renderMessage(text: string, options: { sessionId?: string; withKiloUi?: boolean } = {}) {
	const browserSdk = createFakeSdk({ featureId: "browser" });
	const system = createFakeFeatureSystem({ sdks: { browser: browserSdk } });
	const panel = {
		listTabs: vi.fn(() => []),
		activateTab: vi.fn(),
		openContributedTab: vi.fn(() => ({ instanceId: "browser-1", title: "example.com" })),
	};
	if (options.withKiloUi !== false)
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", panel);
	const extension = BrowserMarkdownExtension({ sessionId: options.sessionId ?? "chat-1" });
	render(
		<SdkProvider system={system}>
			<MarkdownContent text={text} extensions={[extension]} />
		</SdkProvider>,
	);
	return { panel };
}

describe("BrowserMarkdownExtension", () => {
	it("opens a web link from a chat message in a Browser tab of that chat", async () => {
		const { panel } = renderMessage("See [the docs](https://example.com/docs).");

		await page.getByRole("link", { name: "the docs" }).click();

		expect(panel.openContributedTab).toHaveBeenCalledWith(
			"chat-1",
			{ id: "browser.browser", title: "Browser" },
			{ title: "example.com", metadata: { url: "https://example.com/docs" } },
		);
		expect(clicks).toEqual([{ defaultPrevented: true }]);
	});

	it("opens autolinked URLs too", async () => {
		const { panel } = renderMessage("Server running at <http://localhost:5173/>");

		await page.getByRole("link", { name: "http://localhost:5173/" }).click();

		expect(panel.openContributedTab).toHaveBeenCalledWith(
			"chat-1",
			expect.anything(),
			expect.objectContaining({ metadata: { url: "http://localhost:5173/" } }),
		);
	});

	it.each([
		["meta", { metaKey: true }],
		["ctrl", { ctrlKey: true }],
		["shift", { shiftKey: true }],
	] as const)("leaves %s-click to the system browser", async (_name, modifiers) => {
		const { panel } = renderMessage("[docs](https://example.com)");

		page
			.getByRole("link", { name: "docs" })
			.element()
			.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }));

		expect(panel.openContributedTab).not.toHaveBeenCalled();
		expect(clicks).toEqual([{ defaultPrevented: false }]);
	});

	it("leaves links that are not web pages alone", async () => {
		const { panel } = renderMessage("[mail us](mailto:team@example.com)");

		await page.getByRole("link", { name: "mail us" }).click();

		expect(panel.openContributedTab).not.toHaveBeenCalled();
		expect(clicks).toEqual([{ defaultPrevented: false }]);
	});

	it("falls back to the system browser outside a chat session", async () => {
		const { panel } = renderMessage("[docs](https://example.com)", { sessionId: "" });

		await page.getByRole("link", { name: "docs" }).click();

		expect(panel.openContributedTab).not.toHaveBeenCalled();
		expect(clicks).toEqual([{ defaultPrevented: false }]);
	});

	it("falls back to the system browser when the chat pane layout is unavailable", async () => {
		renderMessage("[docs](https://example.com)", { withKiloUi: false });

		await page.getByRole("link", { name: "docs" }).click();

		expect(clicks).toEqual([{ defaultPrevented: false }]);
	});
});
