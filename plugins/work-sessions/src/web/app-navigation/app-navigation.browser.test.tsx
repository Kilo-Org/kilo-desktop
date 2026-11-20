import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { KernelKeybindings } from "@kilo-desktop/kernel";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { renderWorkSessions } from "../../testing";

const tab = (slot: number | "last") => `kilo.work-sessions/pane-${slot}`;
const session = (slot: number | "last") => `kilo.work-sessions/work-session-${slot}`;

describe("App Navigation", () => {
	async function openShortcuts() {
		const { host } = await renderWorkSessions();
		await host.renderer.kernelSdk.domainObjects
			.get(Navigation)!
			.methods.openSettings({ section: "keyboard-shortcuts" });
		await expect.element(page.getByTestId("number-keys-settings")).toBeVisible();
		const overrides = () =>
			host.main.kernelSdk.domainObjects.get(KernelKeybindings)!.getState().overrides;
		return { host, overrides };
	}

	it("swaps the tab and session modifiers, turns sessions off, then restores both", async () => {
		const { overrides } = await openShortcuts();
		await expect.element(page.getByTestId(`shortcut-row-${tab(1)}`)).not.toBeInTheDocument();

		await page.getByTestId("number-keys-customize").click();
		await page.getByTestId("number-keys-tabs-ctrl").click();
		await expect.poll(() => overrides()[tab(1)]).toBe("Ctrl+Digit1");
		expect(overrides()[tab("last")]).toBe("Ctrl+Digit9");
		expect(overrides()[session(1)]).toBe("Meta+Digit1");
		expect(Object.keys(overrides())).toHaveLength(18);
		await expect
			.element(page.getByTestId("number-keys-sessions-meta"))
			.toHaveAttribute("aria-pressed", "true");

		await page.getByTestId("number-keys-toggle-sessions").click();
		await expect.poll(() => overrides()[session(1)]).toBeNull();

		await page.getByTestId("number-keys-restore-defaults").click();
		await expect.poll(overrides).toEqual({});
	});

	it("lists each set as one row in the shortcuts list", async () => {
		const { host } = await openShortcuts();
		void host.renderer.commands.execute("kilo.shell/show-shortcuts");

		const row = page.getByTestId(`keyboard-shortcut-${tab(1)}`);
		await expect.element(row.getByText("Go to tab 1–9")).toBeVisible();
		await expect.element(row.getByText("⌘1–9")).toBeVisible();
		await expect
			.element(page.getByTestId(`keyboard-shortcut-${session(1)}`).getByText("⌃1–9"))
			.toBeVisible();
		await expect.element(page.getByTestId(`keyboard-shortcut-${tab(2)}`)).not.toBeInTheDocument();
	});
});
