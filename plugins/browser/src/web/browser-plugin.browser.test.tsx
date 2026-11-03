import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PaneImplementation } from "@kilo-desktop/plugin-sessions/contracts";

import { BROWSER_PANE_KIND } from "../contracts/index.js";
import { bootBrowserHost } from "../test/browser-host.js";
import { openBrowser } from "./index.js";
import { browserPane } from "../test/sessions-host.js";

const WAIT = { timeout: 5_000 };

async function runOpenBrowser(host: Awaited<ReturnType<typeof bootBrowserHost>>) {
	const command = host.renderer.commands
		.declared()
		.find((candidate) => candidate.key === "kilo.browser/open-browser");
	expect(command?.metadata).toMatchObject({ title: "Open Browser", keybinding: "Mod+Shift+B" });
	await openBrowser(host.sdk);
}

describe("kilo.browser's web entry", () => {
	it("contributes the Browser pane kind, kept alive and launched from new sessions", async () => {
		const host = await bootBrowserHost();

		expect(host.paneKind()?.metadata).toMatchObject({
			title: "Browser",
			keepAlive: true,
			launch: { newSession: true, inSession: true },
			availableWhen: { all: ["kernel/desktop"] },
		});
	});

	it("shows a page's favicon on its tab, else the globe", async () => {
		const host = await bootBrowserHost();
		const { icon: Icon } = host.paneKind()!.implementation as PaneImplementation;

		host.render(
			<>
				<span data-qa-id="favicon">
					{Icon ? <Icon iconKey="data:image/gif;base64,R0lGODlhAQABAAAAACw=" /> : null}
				</span>
				<span data-qa-id="globe">{Icon ? <Icon iconKey="globe" /> : null}</span>
			</>,
		);

		await vi.waitFor(
			() => expect(page.getByTestId("favicon").element().querySelector("img")).not.toBeNull(),
			WAIT,
		);
		expect(page.getByTestId("globe").element().querySelector("svg")).not.toBeNull();
		expect(page.getByTestId("globe").element().querySelector("img")).toBeNull();
	});

	it("Open Browser shows the session's last Browser pane, or opens one", async () => {
		const host = await bootBrowserHost({ panes: [] });

		await runOpenBrowser(host);
		await vi.waitFor(() => expect(host.sessions.panes().panes).toHaveLength(1), WAIT);
		expect(host.sessions.panes().panes[0]?.kind).toBe(BROWSER_PANE_KIND);

		host.sessions.setPanes([browserPane("pane_x"), browserPane("pane_y")]);
		await host.main.flush();
		await runOpenBrowser(host);
		await vi.waitFor(() => expect(host.sessions.panes().activePaneId).toBe("pane_y"), WAIT);
		expect(host.sessions.panes().panes).toHaveLength(2);
	});

	it("Open Browser goes through the workbench's pane launcher when it's there", async () => {
		const openOrShowPane = vi.fn();
		const host = await bootBrowserHost({ panes: [], openOrShowPane });

		await runOpenBrowser(host);

		expect(openOrShowPane).toHaveBeenCalledWith({ kind: BROWSER_PANE_KIND });
		expect(host.sessions.panes().panes).toEqual([]);
	});

	it("Open Browser does nothing without an open session", async () => {
		const host = await bootBrowserHost({ panes: [], activeSessionId: null });

		await runOpenBrowser(host);

		expect(host.sessions.panes().panes).toEqual([]);
	});
});
