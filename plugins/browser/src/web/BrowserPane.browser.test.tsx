import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";

import { BrowserPages, localFileUrl } from "../contracts/index.js";
import { attachGuest, bootBrowserHost, webview } from "../test/browser-host.js";
import { browserPane, SESSION_ID } from "../test/sessions-host.js";

const WAIT = { timeout: 5_000 };
const view = () => page.getByTestId("browser-view");
const guestHost = () => document.querySelector<HTMLElement>("[data-browser-webview-host]");

let panes = 0;

/** Each pane is new: guests outlive their pane for a moment, keyed by pane. */
async function bootPane(metadata: Record<string, string> = {}) {
	panes += 1;
	const host = await bootBrowserHost({ panes: [browserPane(`pane_${panes}`, metadata)] });
	const rendered = host.renderPane();
	await vi.waitFor(() => webview(), WAIT);
	return { ...host, ...rendered };
}

async function attached(host: Awaited<ReturnType<typeof bootPane>>, webContentsId = 42) {
	attachGuest(webContentsId);
	await expect.element(view()).toHaveAttribute("aria-busy", "false");
	return host.fake.guest(webContentsId);
}

describe("the Browser pane", () => {
	it("embeds a guest in the browser partition, clipped to the pane frame", async () => {
		const host = await bootPane({ url: "https://example.com/" });

		expect(host.fake.host.initialize).toHaveBeenCalledOnce();
		expect(webview().getAttribute("partition")).toBe("persist:test-browser");
		expect(webview().getAttribute("src")).toBe("https://example.com/");
		expect(webview().getAttribute("webpreferences")).toContain("sandbox=true");
		await vi.waitFor(() => {
			expect(guestHost()?.style.borderBottomLeftRadius).toBe("12px");
			expect(guestHost()?.style.borderBottomRightRadius).toBe("12px");
			expect(guestHost()?.style.display).toBe("block");
		}, WAIT);
		expect(getComputedStyle(guestHost()!).backgroundColor).toBe("rgb(255, 255, 255)");
	});

	it("opens the page or workspace file it was opened for", async () => {
		await bootPane({ objectType: "kilo.workspaces/file", objectId: "/work/Chart one.html" });

		expect(webview().getAttribute("src")).toBe(localFileUrl("/work/Chart one.html"));
		await expect
			.element(page.getByTestId("browser-url"))
			.toHaveValue("kilo-file://local/work/Chart%20one.html");
	});

	it("hides the guest while the pane is hidden or shows no page", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		await vi.waitFor(() => expect(guestHost()?.style.display).toBe("block"), WAIT);

		host.rerenderPane({ visible: false });
		await vi.waitFor(() => expect(guestHost()?.style.display).toBe("none"), WAIT);

		const blank = await bootPane();
		await expect.element(page.getByText("Enter a URL to start browsing.")).toBeVisible();
		expect(guestHost()?.style.display).toBe("none");
		expect(blank.fake.host.attach).not.toHaveBeenCalled();
	});

	it("attaches its guest once Electron has one, and follows the page", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		await expect.element(view()).toHaveAttribute("aria-busy", "true");

		const guest = await attached(host);
		expect(host.fake.host.attach).toHaveBeenCalledWith(42, expect.any(Function));

		guest.emit({
			url: "https://example.com/docs",
			title: "Docs",
			canGoBack: true,
			zoomFactor: 1.25,
		});
		await expect.element(page.getByTestId("browser-url")).toHaveValue("https://example.com/docs");
		await expect.element(page.getByTestId("browser-back")).toBeEnabled();
		await expect.element(page.getByTestId("browser-forward")).toBeDisabled();
		await vi.waitFor(() => expect(host.sessions.panes().panes[0]?.title).toBe("Docs"), WAIT);
	});

	it("retries attachment after a transient failure", async () => {
		const host = await bootPane();
		host.fake.refuseAttach("Not ready");

		attachGuest(42);
		await vi.waitFor(() => expect(host.fake.host.attach).toHaveBeenCalledOnce(), WAIT);
		await expect.element(page.getByRole("alert")).toHaveTextContent("Not ready");
		await expect.element(view()).toHaveAttribute("aria-busy", "true");

		webview().dispatchEvent(new Event("dom-ready"));
		await expect.element(view()).toHaveAttribute("aria-busy", "false");
		expect(host.fake.host.attach).toHaveBeenCalledTimes(2);
	});

	it("replays dom-ready when it arrives during a failing attachment", async () => {
		const host = await bootPane();
		host.fake.refuseAttach("Guest host is not ready");

		attachGuest(42);
		webview().dispatchEvent(new Event("dom-ready"));

		await expect.element(view()).toHaveAttribute("aria-busy", "false");
		expect(host.fake.host.attach).toHaveBeenCalledTimes(2);
		expect(page.getByRole("alert").query()).toBeNull();
	});

	it("ignores a stale attachment once the guest is replaced", async () => {
		const host = await bootPane();

		attachGuest(42);
		attachGuest(84);

		await expect.element(view()).toHaveAttribute("aria-busy", "false");
		await vi.waitFor(
			() => expect(host.fake.guest(42).controller.dispose).toHaveBeenCalledOnce(),
			WAIT,
		);
		expect(host.fake.host.attach.mock.calls.map(([id]) => id)).toEqual([42, 84]);
		expect(host.fake.guest(84).controller.dispose).not.toHaveBeenCalled();
	});

	it("navigates once attached when the address was entered before", async () => {
		const host = await bootPane();

		await page.getByTestId("browser-url").fill("example.com");
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByTestId("browser-url")).toHaveValue("https://example.com/");
		const guest = await attached(host);

		await vi.waitFor(
			() => expect(guest.controller.navigate).toHaveBeenCalledWith("https://example.com/"),
			WAIT,
		);
	});

	it("navigates from the address bar and restores it on Escape", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		const guest = await attached(host);
		guest.emit({ url: "https://example.com/" });

		await page.getByTestId("browser-url").fill("localhost:5173");
		await userEvent.keyboard("{Enter}");
		await vi.waitFor(
			() => expect(guest.controller.navigate).toHaveBeenCalledWith("http://localhost:5173/"),
			WAIT,
		);

		await page.getByTestId("browser-url").fill("ftp://example.com");
		await userEvent.keyboard("{Enter}");
		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Only HTTP and HTTPS URLs are supported.");
		await page.getByTestId("browser-url").click();
		await userEvent.keyboard("{Escape}");
		expect(page.getByRole("alert").query()).toBeNull();
		await expect.element(page.getByTestId("browser-url")).toHaveValue("https://example.com/");
	});

	it("runs history, reload, zoom and devtools commands on the page", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		const guest = await attached(host);
		guest.emit({ url: "https://example.com/", canGoBack: true, canGoForward: true });
		await expect.element(page.getByTestId("browser-forward")).toBeEnabled();

		await page.getByTestId("browser-back").click();
		await page.getByTestId("browser-forward").click();
		await page.getByTestId("browser-refresh").click();
		await page.getByTestId("browser-menu").click();
		await page.getByTestId("browser-hard-reload").click();
		await page.getByTestId("browser-menu").click();
		await page.getByRole("button", { name: "Zoom in" }).click();
		await page.getByRole("button", { name: "Zoom out" }).click();
		await page.getByTestId("browser-open-devtools").click();

		const { controller } = guest;
		await vi.waitFor(() => {
			expect(controller.goBack).toHaveBeenCalledOnce();
			expect(controller.goForward).toHaveBeenCalledOnce();
			expect(controller.reload).toHaveBeenCalledOnce();
			expect(controller.hardReload).toHaveBeenCalledOnce();
			expect(controller.zoomIn).toHaveBeenCalledOnce();
			expect(controller.zoomOut).toHaveBeenCalledOnce();
			expect(controller.openDevTools).toHaveBeenCalledOnce();
		}, WAIT);

		guest.emit({ zoomFactor: 1.5 });
		await page.getByTestId("browser-menu").click();
		await expect.element(page.getByText("150%")).toBeVisible();
		await page.getByRole("button", { name: "Reset zoom" }).click();
		await vi.waitFor(() => expect(controller.resetZoom).toHaveBeenCalledOnce(), WAIT);
	});

	it("opens the current page in the default browser from the menu", async () => {
		const host = await bootPane({ url: "https://example.com/docs" });
		await attached(host);

		await page.getByTestId("browser-menu").click();
		await page.getByTestId("browser-open-external").click();

		await vi.waitFor(() => expect(host.opened).toEqual(["https://example.com/docs"]), WAIT);
	});

	it("surfaces command failures without an unhandled rejection", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		const guest = await attached(host);
		guest.controller.reload.mockImplementation(() => {
			throw new KernelError("UNAVAILABLE", "Reload failed");
		});

		await page.getByTestId("browser-refresh").click();

		await expect.element(page.getByRole("alert")).toHaveTextContent("Reload failed");
	});

	it("shows a page that failed to load, with a retry", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		const guest = await attached(host);

		guest.emit({
			url: "https://example.com/",
			failure: { code: -105, description: "ERR_NAME_NOT_RESOLVED" },
		});
		await expect.element(page.getByText("Could not load this page")).toBeVisible();
		await vi.waitFor(() => expect(guestHost()?.style.display).toBe("none"), WAIT);
		await page.getByRole("button", { name: "Try again" }).click();

		await vi.waitFor(() => expect(guest.controller.reload).toHaveBeenCalledOnce(), WAIT);
	});

	it("shows loading progress while the page loads", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		const guest = await attached(host);

		guest.emit({ url: "https://example.com/", loading: true });
		await expect.element(page.getByTestId("browser-load-progress")).toBeInTheDocument();

		guest.emit({ loading: false });
		await vi.waitFor(
			() => expect(page.getByTestId("browser-load-progress").query()).toBeNull(),
			WAIT,
		);
	});

	it("reloads a guest whose process stopped, then gives up", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		attachGuest(42);
		await expect.element(view()).toHaveAttribute("aria-busy", "false");
		const reload = vi.fn();
		Object.assign(webview(), { reload });

		webview().dispatchEvent(new Event("render-process-gone"));
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce(), WAIT);
		webview().dispatchEvent(new Event("render-process-gone"));
		webview().dispatchEvent(new Event("render-process-gone"));
		webview().dispatchEvent(new Event("render-process-gone"));

		await expect.element(page.getByText(/stopped repeatedly/)).toBeVisible();
		expect(host.fake.host.attach).toHaveBeenCalledOnce();
	});

	it("lets its guest go when it unmounts", async () => {
		const host = await bootPane({ url: "https://example.com/" });
		const guest = await attached(host);

		host.unmount();

		await vi.waitFor(() => expect(guest.controller.dispose).toHaveBeenCalledOnce(), WAIT);
		expect(host.main.kernelSdk.domains.get(BrowserPages)?.getState().pages).toEqual({});
	});

	it("says the browser isn't available without kilo.browser's main", async () => {
		const host = await bootBrowserHost({ withoutMain: true });
		host.renderPane();

		await expect.element(page.getByTestId("browser-unavailable")).toBeVisible();
	});

	it("reports a host without an embedded browser", async () => {
		const host = await bootBrowserHost({ withoutHost: true });
		host.renderPane({ sessionId: SESSION_ID });

		await expect.element(page.getByText("The browser isn't available here.")).toBeVisible();
	});
});
