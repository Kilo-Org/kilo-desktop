import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { detectKeyboardPlatform } from "@kilo-desktop/feature-sdk";
import { SdkProvider, useCommand } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";

import { readKeybindingOverrides } from "./keybinding-overrides";
import { rememberCommands } from "./known-commands";
import { SHELL_FEATURE_ID } from "./shell-feature";
import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings";
import { ShortcutsHost } from "./ShortcutsHost";

const mac = detectKeyboardPlatform() === "mac";
const TABS = { id: "probe-tabs", label: "Go to probe tab 1–9", modifierChoice: true };
const SESSIONS = { id: "probe-sessions", label: "Go to probe session 1–9", modifierChoice: true };

function Probe({ onRun, onTab }: { onRun: () => void; onTab: () => void }) {
	useCommand("probe", {
		id: "run",
		label: "Run probe",
		group: "Tabs",
		keybinding: "Ctrl+Shift+K",
		handler: onRun,
	});
	useCommand("probe", {
		id: "tab-1",
		label: "Go to tab 1",
		group: "Tabs",
		keybinding: "Mod+1",
		configurable: false,
		series: TABS,
		handler: onTab,
	});
	useCommand("probe", {
		id: "session-1",
		label: "Go to session 1",
		group: "Sessions",
		keybinding: { mac: "Ctrl+1", default: "Alt+1" },
		configurable: false,
		series: SESSIONS,
		handler: () => undefined,
	});
	return null;
}

function renderSettings({ onRun = vi.fn(), onTab = vi.fn() } = {}) {
	const system = createFakeFeatureSystem({
		sdks: { probe: createFakeSdk({ featureId: "probe" }) },
	});
	render(
		<LocalApiProvider api={createBrowserLocalApi()}>
			<SdkProvider system={system}>
				<ShortcutsHost />
				<Probe onRun={onRun} onTab={onTab} />
				<KeyboardShortcutsSettings />
			</SdkProvider>
		</LocalApiProvider>,
	);
	return system;
}

afterEach(() => {
	cleanup();
	globalThis.localStorage.clear();
});

describe("KeyboardShortcutsSettings", () => {
	it("records a shortcut without running it, turns it off, and resets", async () => {
		const onRun = vi.fn();
		renderSettings({ onRun });
		const recorder = page.getByTestId("shortcut-recorder-probe.run");

		await recorder.click();
		await userEvent.keyboard("k");
		await userEvent.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");
		expect(onRun).not.toHaveBeenCalled();
		expect(readKeybindingOverrides()["probe.run"]).toEqual({ chords: ["Ctrl+Alt+KeyJ"] });

		await recorder.hover();
		await page.getByTestId("shortcut-turn-off-probe.run").click();
		expect(readKeybindingOverrides()["probe.run"]).toEqual({ disabled: true });
		await expect.element(recorder).toHaveTextContent("None");

		await page.getByTestId("keyboard-shortcuts-reset-all").click();
		expect(readKeybindingOverrides()).toEqual({});
		await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
		expect(onRun).toHaveBeenCalledOnce();
	});

	it("refuses a chord reserved for the clipboard and keeps recording", async () => {
		renderSettings();
		await page.getByTestId("shortcut-recorder-probe.run").click();
		await userEvent.keyboard(mac ? "{Meta>}v{/Meta}" : "{Control>}v{/Control}");

		await expect
			.element(page.getByTestId("shortcut-rejected-probe.run"))
			.toHaveTextContent(`${mac ? "⌘V" : "Ctrl+V"} is reserved for Paste.`);
		expect(readKeybindingOverrides()).toEqual({});
	});

	it("moves a numbered series to another modifier, swapping with the series that had it", async () => {
		const onTab = vi.fn();
		renderSettings({ onTab });
		const sessionsModifier = mac ? "ctrl" : "alt";

		await page.getByTestId("number-keys-customize").click();
		await page.getByTestId(`number-keys-probe-tabs-${sessionsModifier}`).click();

		expect(readKeybindingOverrides()).toEqual({
			"series:probe-tabs": { modifier: sessionsModifier },
			"series:probe-sessions": { modifier: mac ? "meta" : "ctrl" },
		});
		await userEvent.keyboard(mac ? "{Control>}1{/Control}" : "{Alt>}1{/Alt}");
		expect(onTab).toHaveBeenCalledOnce();
	});

	it("keeps a series' modifier when its selected option is clicked again", async () => {
		renderSettings();
		const tabsModifier = mac ? "meta" : "ctrl";

		await page.getByTestId("number-keys-customize").click();
		const selected = page.getByTestId(`number-keys-probe-tabs-${tabsModifier}`);
		await selected.click();

		await expect.element(selected).toHaveAttribute("aria-pressed", "true");
		expect(readKeybindingOverrides()).toEqual({});
	});

	it("opens the full list from Settings, including shortcuts of screens not mounted", async () => {
		rememberCommands([
			{
				id: "chat.send",
				featureId: "chat",
				label: "Send message",
				group: "Composer",
				keybinding: "Enter",
				handledLocally: true,
				handler: () => undefined,
			},
		]);
		renderSettings();
		await page.getByTestId("keyboard-shortcuts-show-all").click();
		await expect.element(page.getByTestId("keyboard-shortcut-chat.send")).toBeVisible();
	});

	it("opens Settings from the list footer and starts the next search empty", async () => {
		const system = renderSettings();
		const navigate = vi.spyOn(system.getSdk(SHELL_FEATURE_ID), "navigate");
		await page.getByTestId("keyboard-shortcuts-show-all").click();
		await userEvent.keyboard("run");
		await page.getByTestId("keyboard-shortcuts-open-settings").click();

		expect(navigate).toHaveBeenCalledWith("/settings/keyboard-shortcuts");
		await expect.element(page.getByTestId("keyboard-shortcuts-dialog")).not.toBeInTheDocument();
		await page.getByTestId("keyboard-shortcuts-show-all").click();
		await expect.element(page.getByTestId("keyboard-shortcuts-search")).toHaveValue("");
	});

	it("filters the full list as you type", async () => {
		renderSettings();
		await page.getByTestId("keyboard-shortcuts-show-all").click();
		await userEvent.keyboard("run pro");
		await expect.element(page.getByTestId("keyboard-shortcut-probe.run")).toBeVisible();
		await expect.element(page.getByText(/^1 of \d+$/)).toBeVisible();

		await userEvent.keyboard("zzz");
		await expect.element(page.getByText("No shortcuts match “run prozzz”.")).toBeVisible();
	});

	it("runs no shortcut behind an open dialog, but does as soon as it closes", async () => {
		const onRun = vi.fn();
		renderSettings({ onRun });
		await userEvent.keyboard(mac ? "{Meta>}/{/Meta}" : "{Control>}/{/Control}");
		await expect.element(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
		await expect
			.poll(() => document.activeElement?.getAttribute("data-qa-id"))
			.toBe("keyboard-shortcuts-search");

		await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
		expect(onRun).not.toHaveBeenCalled();

		// Pressed during the close animation, while the dialog is still in the DOM.
		await userEvent.keyboard("{Escape}{Control>}{Shift>}k{/Shift}{/Control}");
		expect(onRun).toHaveBeenCalledOnce();
	});
});
