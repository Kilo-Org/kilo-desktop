import { CircleIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelCommand } from "@kilo-desktop/kernel";

import { Main, StatusBarItem, type StatusBarItemImplementation } from "../../contracts";
import { contributor, renderShell } from "../../testing";

const bar = () => page.getByTestId("shell-status-bar");

/** A plugin contributing status items, each declared in the manifest and bound in the renderer. */
function items(
	entries: readonly (Record<string, unknown> & { id: string })[],
	implementations: Readonly<Record<string, StatusBarItemImplementation>>,
	extra: {
		activate?: Parameters<typeof contributor>[2];
		extensions?: Record<string, unknown[]>;
	} = {},
) {
	const extensions = { "kilo.shell/status-bar-item": [...entries], ...extra.extensions };
	return contributor("acme.status", extensions, (sdk) => {
		for (const [id, implementation] of Object.entries(implementations)) {
			sdk.extensions.implement(StatusBarItem, id, implementation);
		}
		extra.activate?.(sdk);
	});
}

/** A toggle tests flip from outside React. */
function externalFlag(initial: boolean) {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		set(next: boolean) {
			value = next;
			for (const listener of listeners) listener();
		},
		use: () =>
			useSyncExternalStore(
				(onChange) => {
					listeners.add(onChange);
					return () => listeners.delete(onChange);
				},
				() => value,
			),
	};
}

describe("the status bar", () => {
	it("is absent while nothing is contributed", async () => {
		await renderShell();
		await expect.element(page.getByTestId("shell-main")).toBeVisible();

		await expect.element(bar()).not.toBeInTheDocument();
	});

	it("draws views, and puts items at their side in priority order", async () => {
		await renderShell([
			items(
				[
					{ id: "branch", title: "Branch", align: "start" },
					{ id: "sync", title: "Sync", priority: 10 },
					{ id: "server", title: "Server", priority: 20 },
				],
				{
					branch: { kind: "view", Component: () => <span>main</span> },
					sync: { kind: "view", Component: () => <span>Synced</span> },
					server: { kind: "view", Component: () => <span>Server ready</span> },
				},
			),
		]);

		await expect.element(bar().getByText("Server ready")).toBeVisible();
		const start = bar().getByTestId("shell-status-bar-start");
		const end = bar().getByTestId("shell-status-bar-end");
		expect(start.element().textContent).toBe("main");
		expect(end.element().textContent).toBe("Server readySynced");
	});

	it("runs an action's `run`, or its command", async () => {
		const run = vi.fn();
		const command = vi.fn();
		await renderShell([
			items(
				[
					{ id: "sync", title: "Sync now", kind: "action" },
					{ id: "logs", title: "Open logs", kind: "action", command: "acme.status/open-logs" },
				],
				{
					sync: {
						kind: "action",
						Trigger: ({ children }) => children({ label: "Sync", icon: CircleIcon }),
						run,
					},
				},
				{
					extensions: { "kernel/command": [{ id: "open-logs", title: "Open logs" }] },
					activate: (sdk) => sdk.extensions.implement(KernelCommand, "open-logs", command),
				},
			),
		]);

		await bar().getByRole("button", { name: "Sync now" }).click();
		await bar().getByRole("button", { name: "Open logs" }).click();

		expect(run).toHaveBeenCalledOnce();
		await expect.poll(() => command.mock.calls.length).toBe(1);
	});

	it("opens a popover above the bar, which its content can close", async () => {
		await renderShell([
			items([{ id: "activity", title: "Plugin activity", kind: "popover" }], {
				activity: {
					kind: "popover",
					Trigger: ({ children }) => children({ label: "3 plugins", tone: "warning" }),
					Content: ({ close }) => (
						<div>
							<p>kilo.agent failed</p>
							<button type="button" onClick={close}>
								Done
							</button>
						</div>
					),
				},
			}),
		]);

		const trigger = bar().getByRole("button", { name: "Plugin activity" });
		await expect.element(trigger).toHaveTextContent("3 plugins");
		await expect.element(trigger).toHaveAttribute("data-tone", "warning");
		await trigger.click();
		await expect.element(page.getByText("kilo.agent failed")).toBeVisible();

		await page.getByRole("button", { name: "Done" }).click();
		await expect.element(page.getByText("kilo.agent failed")).not.toBeInTheDocument();
	});

	it("hides while every item renders nothing, and shows again when one does", async () => {
		const flag = externalFlag(false);
		await renderShell([
			items(
				[
					{ id: "quiet", title: "Quiet" },
					{ id: "alert", title: "Alert", kind: "action" },
				],
				{
					quiet: { kind: "view", Component: () => (flag.use() ? <span>Busy</span> : null) },
					alert: {
						kind: "action",
						Trigger: ({ children }) => children({ label: "!", hidden: !flag.use() }),
					},
				},
			),
		]);
		await expect.element(page.getByTestId("shell-main")).toBeVisible();

		await expect.element(bar()).not.toBeVisible();

		flag.set(true);
		await expect.element(bar().getByText("Busy")).toBeVisible();
		await expect.element(bar().getByRole("button", { name: "Alert" })).toBeVisible();
	});

	it("mirrors the top bar's height, with items level with the sidebar footer", async () => {
		await page.viewport(1280, 800);
		await renderShell([
			items(
				[{ id: "summary", title: "Summary", kind: "action" }],
				{
					summary: {
						kind: "action",
						Trigger: ({ children }) => children({ label: "21 plugins" }),
						run: () => {},
					},
				},
				{
					// A titled home, so the top bar keeps its full height to mirror.
					extensions: { "kilo.shell/main": [{ id: "home", title: "Sessions" }] },
					activate: (sdk) => sdk.extensions.implement(Main, "home", { component: () => null }),
				},
			),
		]);
		await expect.element(bar().getByRole("button", { name: "Summary" })).toBeVisible();

		const box = (element: Element) => element.getBoundingClientRect();
		const middle = (element: Element) => box(element).top + box(element).height / 2;
		const header = box(page.getByTestId("shell-top-bar").element());
		const main = box(page.getByTestId("shell-main").element());
		const barBox = box(bar().element());
		expect(barBox.height).toBe(header.height);
		// The gutter between the main pane and the status bar matches the one under the top bar.
		expect(barBox.top - main.bottom).toBe(main.top - header.bottom);
		const item = bar().getByRole("button", { name: "Summary" }).element();
		const settings = page.getByTestId("nav-settings").element();
		expect(Math.abs(middle(item) - middle(settings))).toBeLessThanOrEqual(0.5);
	});

	it("leaves out an item whose `when` doesn't hold", async () => {
		await renderShell([
			items(
				[
					{ id: "shown", title: "Shown" },
					{ id: "gated", title: "Gated", when: { all: ["acme.status/never"] } },
				],
				{
					shown: { kind: "view", Component: () => <span>Shown item</span> },
					gated: { kind: "view", Component: () => <span>Gated item</span> },
				},
			),
		]);

		await expect.element(bar().getByText("Shown item")).toBeVisible();
		await expect.element(bar().getByText("Gated item")).not.toBeInTheDocument();
	});
});
