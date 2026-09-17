import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import type { ChannelHandlerMap } from "@anaconda-agentic-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { browserContract } from "../contracts/browser.js";
import { BrowserView } from "./BrowserView.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	document.querySelectorAll("[data-browser-webview-host]").forEach((element) => element.remove());
});

function renderView(
	handlers: Partial<ChannelHandlerMap<typeof browserContract>>,
	instanceId = "browser-1",
) {
	const sdk = createFakeSdk({
		featureId: "browser",
		channels: browserContract,
		handlers: { detach: async () => undefined, ...handlers },
	});
	const system = createFakeFeatureSystem({ sdks: { browser: sdk } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
		registerTabLifecycle: vi.fn(() => vi.fn()),
		updateTab: vi.fn(),
	});
	const originalCreateElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation(((
		tagName: string,
		options?: ElementCreationOptions,
	) => {
		const element = originalCreateElement(tagName, options);
		if (tagName === "webview") {
			Object.assign(element, { getWebContentsId: () => 42, reload: vi.fn() });
		}
		return element;
	}) as typeof document.createElement);
	return render(
		<SdkProvider system={system}>
			<div
				data-qa-id="chat-pane-frame"
				style={{ borderBottomLeftRadius: "12px", borderBottomRightRadius: "12px" }}
			>
				<BrowserView sessionId="chat-1" instanceId={instanceId} title="Browser" />
			</div>
		</SdkProvider>,
	);
}

describe("BrowserView", () => {
	it("clips the guest to the pane frame bottom corners", async () => {
		renderView({ config: async () => ({ partition: "persist:test" }) }, "browser-corners");

		await vi.waitFor(() => {
			const host = document.querySelector<HTMLElement>("[data-browser-webview-host]");
			expect(host?.style.borderBottomLeftRadius).toBe("12px");
			expect(host?.style.borderBottomRightRadius).toBe("12px");
		});
	});

	it("retries attachment after a transient failure", async () => {
		const attach = vi.fn().mockRejectedValueOnce(new Error("Not ready")).mockResolvedValueOnce({
			instanceId: "browser-1",
			webContentsId: 42,
			url: "",
			title: "",
			faviconUrl: "",
			loading: false,
			canGoBack: false,
			canGoForward: false,
			zoomFactor: 1,
		});
		renderView({ config: async () => ({ partition: "persist:test" }), attach });
		await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce());

		const webview = document.querySelector("webview");
		if (!webview) throw new Error("Expected browser webview");
		webview.dispatchEvent(new Event("dom-ready"));

		await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(2));
	});

	it("exposes guest attachment so navigation can wait for the host lease", async () => {
		let resolveAttach!: (
			state: Awaited<ReturnType<ChannelHandlerMap<typeof browserContract>["attach"]>>,
		) => void;
		const attach = vi.fn(
			() =>
				new Promise<Awaited<ReturnType<ChannelHandlerMap<typeof browserContract>["attach"]>>>(
					(resolve) => {
						resolveAttach = resolve;
					},
				),
		);
		renderView({ config: async () => ({ partition: "persist:test" }), attach });
		const view = page.getByTestId("browser-view");
		await expect.element(view).toHaveAttribute("aria-busy", "true");
		await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce());

		resolveAttach({
			instanceId: "browser-1",
			webContentsId: 42,
			url: "",
			title: "",
			faviconUrl: "",
			loading: false,
			canGoBack: false,
			canGoForward: false,
			zoomFactor: 1,
		});

		await expect.element(view).toHaveAttribute("aria-busy", "false");
	});

	it("does not lose navigation while attachment state is rendering", async () => {
		let resolveAttach!: (
			state: Awaited<ReturnType<ChannelHandlerMap<typeof browserContract>["attach"]>>,
		) => void;
		const attach = vi.fn(
			() =>
				new Promise<Awaited<ReturnType<ChannelHandlerMap<typeof browserContract>["attach"]>>>(
					(resolve) => {
						resolveAttach = resolve;
					},
				),
		);
		const navigate = vi.fn(async () => undefined);
		renderView({ config: async () => ({ partition: "persist:test" }), attach, navigate });
		await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce());

		await page.getByTestId("browser-url").fill("example.com");
		resolveAttach({
			instanceId: "browser-1",
			webContentsId: 42,
			url: "",
			title: "",
			faviconUrl: "",
			loading: false,
			canGoBack: false,
			canGoForward: false,
			zoomFactor: 1,
		});
		page.getByTestId("browser-url").element().focus();
		await userEvent.keyboard("{Enter}");

		await vi.waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				instanceId: "browser-1",
				url: "https://example.com/",
			}),
		);
	});

	it("surfaces command failures without an unhandled rejection", async () => {
		const reload = vi.fn(async () => {
			throw new Error("Reload failed");
		});
		renderView(
			{
				config: async () => ({ partition: "persist:test" }),
				attach: async () => ({
					instanceId: "browser-2",
					webContentsId: 42,
					url: "https://example.com/",
					title: "Example",
					faviconUrl: "",
					loading: false,
					canGoBack: false,
					canGoForward: false,
					zoomFactor: 1,
				}),
				reload,
			},
			"browser-2",
		);
		await vi.waitFor(() => expect(document.querySelector("webview")).not.toBeNull());
		await page.getByTestId("browser-refresh").click();

		await expect.element(page.getByRole("alert")).toHaveTextContent("Reload failed");
	});
});
