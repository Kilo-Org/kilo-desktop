import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { webRegister } from "./index.js";

type Tab = {
	instanceId: string;
	definitionId: string;
	metadata?: Readonly<Record<string, string>>;
};

function makeSystem(options: { tabs?: Tab[]; withKiloUi?: boolean } = {}) {
	const browserSdk = createFakeSdk({ featureId: "browser" });
	const system = createFakeFeatureSystem({ sdks: { browser: browserSdk } });
	const panel = {
		listTabs: vi.fn((): readonly Tab[] => options.tabs ?? []),
		activateTab: vi.fn(),
		openContributedTab: vi.fn(() => ({ instanceId: "browser-new", title: "localhost:5173" })),
		updateTab: vi.fn(),
		registerTabLifecycle: vi.fn(() => () => {}),
	};
	if (options.withKiloUi !== false) {
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", panel);
	}
	webRegister(browserSdk);
	const openBrowser = (args: Record<string, unknown>, kiloSessionId: string | null = "chat-1") =>
		system.services.toolRegistry.invoke(
			"browser",
			"open",
			args,
			kiloSessionId ? { kiloSessionId } : {},
		);
	return { system, panel, openBrowser };
}

describe("browser_open WebMCP tool", () => {
	it("is exposed to the model", () => {
		const { system } = makeSystem();

		const tool = system.services.toolRegistry.all().find((entry) => entry.id === "browser.open");
		expect(tool?.exposeToModelContext).toBe(true);
		expect(tool?.annotations?.openWorldHint).toBe(true);
	});

	it("opens a Browser tab at the URL in the calling chat", async () => {
		const { panel, openBrowser } = makeSystem();

		await expect(openBrowser({ url: "localhost:5173/docs" })).resolves.toEqual({
			sessionId: "chat-1",
			instanceId: "browser-new",
			url: "http://localhost:5173/docs",
		});
		expect(panel.openContributedTab).toHaveBeenCalledWith(
			"chat-1",
			{ id: "browser.browser", title: "Browser" },
			{ title: "localhost:5173", metadata: { url: "http://localhost:5173/docs" } },
		);
	});

	it("focuses a Browser tab already showing the URL", async () => {
		const { panel, openBrowser } = makeSystem({
			tabs: [
				{
					instanceId: "browser-1",
					definitionId: "browser.browser",
					metadata: { url: "https://example.com/" },
				},
			],
		});

		await expect(openBrowser({ url: "https://example.com" })).resolves.toEqual({
			sessionId: "chat-1",
			instanceId: "browser-1",
			url: "https://example.com/",
		});
		expect(panel.activateTab).toHaveBeenCalledWith("chat-1", "browser-1");
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it.each(["file:///etc/passwd", "javascript:alert(1)", "   "])("refuses %j", async (url) => {
		const { panel, openBrowser } = makeSystem();

		await expect(openBrowser({ url })).resolves.toEqual({ error: expect.any(String) });
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("requires an originating Kilo chat session", async () => {
		const { openBrowser } = makeSystem();

		await expect(openBrowser({ url: "https://example.com" }, null)).resolves.toEqual({
			error: expect.stringContaining("originating Kilo chat session"),
		});
	});

	it("reports when the chat UI is unavailable", async () => {
		const { openBrowser } = makeSystem({ withKiloUi: false });

		await expect(openBrowser({ url: "https://example.com" })).resolves.toEqual({
			error: expect.stringContaining("unavailable"),
		});
	});
});
