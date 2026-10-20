import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { on: vi.fn(), off: vi.fn() },
	webContents: { getAllWebContents: vi.fn(() => []), fromId: vi.fn() },
}));

import type { ShortcutBinding } from "@kilo-desktop/contracts";

import { resolveShortcutInput, type ShortcutInput } from "./ElectronShortcuts.js";

const table = new Map<string, ShortcutBinding>([
	["Meta+Digit1", { chord: "Meta+Digit1", commandId: "kilo-ui.tab-1" }],
	["Ctrl+Tab", { chord: "Ctrl+Tab", commandId: "kilo-ui.next-session", repeatable: true }],
]);

function input(overrides: Partial<ShortcutInput>): ShortcutInput {
	return {
		type: "keyDown",
		key: "",
		code: "",
		meta: false,
		control: false,
		alt: false,
		shift: false,
		isAutoRepeat: false,
		...overrides,
	};
}

describe("resolveShortcutInput", () => {
	it("swallows auto-repeat unless the binding is repeatable", () => {
		expect(
			resolveShortcutInput(
				table,
				input({ key: "1", code: "Digit1", meta: true, isAutoRepeat: true }),
			),
		).toEqual({ action: "swallow" });
		expect(
			resolveShortcutInput(
				table,
				input({ key: "Tab", code: "Tab", control: true, isAutoRepeat: true }),
			),
		).toEqual({ action: "dispatch", commandId: "kilo-ui.next-session", chord: "Ctrl+Tab" });
	});
});
