import type { MenuItemConstructorOptions } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

const { buildFromTemplate, popup, fromWebContents, writeText } = vi.hoisted(() => {
	const popup = vi.fn();
	return {
		popup,
		buildFromTemplate: vi.fn(() => ({ popup })),
		fromWebContents: vi.fn(),
		writeText: vi.fn(),
	};
});

vi.mock("electron", () => ({
	Menu: { buildFromTemplate },
	BrowserWindow: { fromWebContents },
	clipboard: { writeText },
}));

import {
	attachContextMenu,
	buildContextMenuTemplate,
	type ContextMenuTarget,
} from "./ElectronContextMenu.js";

afterEach(() => {
	vi.clearAllMocks();
});

const NO_EDIT_FLAGS = {
	canUndo: false,
	canRedo: false,
	canCut: false,
	canCopy: false,
	canPaste: false,
	canDelete: false,
	canSelectAll: false,
	canEditRichly: false,
};

function target(overrides: Partial<ContextMenuTarget> = {}): ContextMenuTarget {
	return {
		x: 10,
		y: 20,
		isEditable: false,
		editFlags: NO_EDIT_FLAGS,
		selectionText: "",
		misspelledWord: "",
		dictionarySuggestions: [],
		linkURL: "",
		...overrides,
	};
}

function createActions() {
	return {
		replaceMisspelling: vi.fn(),
		addToDictionary: vi.fn(),
		copyLink: vi.fn(),
		inspectElement: vi.fn(),
	};
}

function build(params: ContextMenuTarget, isDevelopment = false, actions = createActions()) {
	return buildContextMenuTemplate(params, { isDevelopment, actions });
}

describe("buildContextMenuTemplate", () => {
	it("offers native edit actions in an editable field, enabled per the field's capabilities", () => {
		const template = build(
			target({
				isEditable: true,
				editFlags: { ...NO_EDIT_FLAGS, canPaste: true, canSelectAll: true, canUndo: true },
			}),
		);

		expect(template).toEqual([
			{ role: "undo", enabled: true },
			{ role: "redo", enabled: false },
			{ type: "separator" },
			{ role: "cut", enabled: false },
			{ role: "copy", enabled: false },
			{ role: "paste", enabled: true },
			{ type: "separator" },
			{ role: "selectAll", enabled: true },
		]);
	});

	it("puts spelling suggestions above the edit actions and applies the chosen one", () => {
		const actions = createActions();
		const template = build(
			target({
				isEditable: true,
				misspelledWord: "teh",
				dictionarySuggestions: ["the", "tech"],
			}),
			false,
			actions,
		);

		expect(template.slice(0, 5).map((item) => item.label ?? item.type)).toEqual([
			"the",
			"tech",
			"separator",
			"Add to Dictionary",
			"separator",
		]);
		expect(template[5]).toEqual({ role: "undo", enabled: false });

		template[1]?.click?.(...clickArgs());
		expect(actions.replaceMisspelling).toHaveBeenCalledWith("tech");
		template[3]?.click?.(...clickArgs());
		expect(actions.addToDictionary).toHaveBeenCalledWith("teh");
	});

	it("says there are no guesses when a misspelled word has no suggestions", () => {
		const template = build(target({ isEditable: true, misspelledWord: "qwzx" }));

		expect(template[0]).toEqual({ label: "No Guesses Found", enabled: false });
		expect(template[2]?.label).toBe("Add to Dictionary");
	});

	it("offers Copy for selected text outside an editable field", () => {
		expect(build(target({ selectionText: "hello world" }))).toEqual([{ role: "copy" }]);
	});

	it("offers Copy Link on a link, after any selection actions", () => {
		const actions = createActions();
		const template = build(
			target({ selectionText: "docs", linkURL: "https://example.com/docs" }),
			false,
			actions,
		);

		expect(template.map((item) => item.label ?? item.role ?? item.type)).toEqual([
			"copy",
			"separator",
			"Copy Link",
		]);
		template[2]?.click?.(...clickArgs());
		expect(actions.copyLink).toHaveBeenCalledWith("https://example.com/docs");
	});

	it("adds Inspect Element at the click position only in development", () => {
		const actions = createActions();
		const development = build(target({ x: 5, y: 7 }), true, actions);

		expect(development.map((item) => item.label)).toEqual(["Inspect Element"]);
		development[0]?.click?.(...clickArgs());
		expect(actions.inspectElement).toHaveBeenCalledWith(5, 7);

		expect(build(target({ x: 5, y: 7 }), false)).toEqual([]);
	});

	it("shows no menu when nothing actionable was right-clicked", () => {
		expect(build(target({ selectionText: "  \n" }))).toEqual([]);
	});
});

function createContents(hostWebContents?: { id: number }) {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	return {
		id: 3,
		hostWebContents,
		session: { addWordToSpellCheckerDictionary: vi.fn() },
		replaceMisspelling: vi.fn(),
		inspectElement: vi.fn(),
		on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
			listeners.set(name, listener);
		}),
		off: vi.fn((name: string) => listeners.delete(name)),
		rightClick(params: ContextMenuTarget & { frame?: unknown }) {
			listeners.get("context-menu")?.({ preventDefault: vi.fn() }, params);
		},
	};
}

function builtTemplate(): MenuItemConstructorOptions[] {
	return (buildFromTemplate.mock.calls.at(-1) as unknown as [MenuItemConstructorOptions[]])[0];
}

function itemLabelled(label: string): MenuItemConstructorOptions {
	const item = builtTemplate().find((entry) => entry.label === label);
	if (!item) throw new Error(`No menu item labelled ${label}`);
	return item;
}

describe("attachContextMenu", () => {
	it("pops the menu up over the owning window and frame so macOS system items are enabled", () => {
		const contents = createContents();
		const ownerWindow = { id: "window" };
		fromWebContents.mockReturnValue(ownerWindow);
		const frame = { name: "frame" };
		attachContextMenu(contents as never, { isDevelopment: false });

		contents.rightClick({ ...target({ isEditable: true }), frame });

		expect(fromWebContents).toHaveBeenCalledWith(contents);
		expect(popup).toHaveBeenCalledWith({ window: ownerWindow, frame });
	});

	it("resolves an embedded page's menu to the window hosting it", () => {
		const host = { id: 7 };
		const contents = createContents(host);
		attachContextMenu(contents as never, { isDevelopment: false });

		contents.rightClick(target({ selectionText: "text" }));

		expect(fromWebContents).toHaveBeenCalledWith(host);
	});

	it("does not open an empty menu", () => {
		const contents = createContents();
		attachContextMenu(contents as never, { isDevelopment: false });

		contents.rightClick(target());

		expect(buildFromTemplate).not.toHaveBeenCalled();
		expect(popup).not.toHaveBeenCalled();
	});

	it("routes menu actions to the right-clicked page", () => {
		const contents = createContents();
		attachContextMenu(contents as never, { isDevelopment: true });

		contents.rightClick(
			target({
				x: 4,
				y: 9,
				isEditable: true,
				misspelledWord: "teh",
				dictionarySuggestions: ["the"],
				linkURL: "https://example.com/",
			}),
		);
		itemLabelled("the").click?.(...clickArgs());
		itemLabelled("Add to Dictionary").click?.(...clickArgs());
		itemLabelled("Copy Link").click?.(...clickArgs());
		itemLabelled("Inspect Element").click?.(...clickArgs());

		expect(contents.replaceMisspelling).toHaveBeenCalledWith("the");
		expect(contents.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("teh");
		expect(writeText).toHaveBeenCalledWith("https://example.com/");
		expect(contents.inspectElement).toHaveBeenCalledWith(4, 9);
	});

	it("stops showing the menu once detached", () => {
		const contents = createContents();
		const detach = attachContextMenu(contents as never, { isDevelopment: false });

		detach();
		contents.rightClick(target({ isEditable: true }));

		expect(popup).not.toHaveBeenCalled();
	});
});

function clickArgs(): Parameters<NonNullable<MenuItemConstructorOptions["click"]>> {
	return [{} as never, undefined, {} as never];
}
