import type { MenuItemConstructorOptions } from "electron";

import { parseChord, type AppMenuNode, type KeyboardPlatform } from "@kilo-desktop/kernel";

export interface WindowMenusOptions {
	/** A window's tree as an Electron template; its commands run in that window. */
	render(windowId: string, menus: readonly AppMenuNode[]): MenuItemConstructorOptions[];
	/** The host's menu, for a window that hasn't set one. */
	fallback(): MenuItemConstructorOptions[];
	show(template: MenuItemConstructorOptions[]): void;
}

/**
 * The native menu follows the focused window. Each window sets its own tree
 * (`kernel/app-menu`), because only the window can judge its commands' `when`
 * conditions; this keeps the latest tree per window and shows the focused
 * window's, or the host's fallback until that window sets one. Windows in
 * the background update silently. One application menu serves every
 * platform: windows draw their own title bar, so no window shows a menu bar
 * of its own, and the menu is reached through its shortcuts and, on macOS,
 * the menu bar.
 */
export class WindowMenus {
	readonly #options: WindowMenusOptions;
	readonly #menus = new Map<string, readonly AppMenuNode[]>();
	#focused: string | undefined;

	constructor(options: WindowMenusOptions) {
		this.#options = options;
	}

	set(windowId: string, menus: readonly AppMenuNode[]): void {
		this.#menus.set(windowId, menus);
		if (windowId === this.#focused) this.refresh();
	}

	focus(windowId: string): void {
		this.#focused = windowId;
		this.refresh();
	}

	close(windowId: string): void {
		this.#menus.delete(windowId);
		if (windowId === this.#focused) this.refresh();
	}

	/** Redraws the shown menu, e.g. after commands or shortcuts change. */
	refresh(): void {
		const menus = this.#focused === undefined ? undefined : this.#menus.get(this.#focused);
		this.#options.show(
			menus && this.#focused !== undefined
				? this.#options.render(this.#focused, menus)
				: this.#options.fallback(),
		);
	}
}

/** What the menu needs to know about commands, read from the main kernel. */
export interface MenuCommands {
	/** The command's title, or undefined when no plugin declares it. */
	title(key: string): string | undefined;
	/** The command's current shortcut (canonical chord), if it has one. */
	chord(key: string): string | undefined;
	run(key: string): void;
}

/**
 * Turns a window's menu tree (`kernel/app-menu`) into an Electron template.
 * Command shortcuts are shown but not registered: the kernel's key capture
 * stays the one place keys are handled, so a menu accelerator can never run a
 * command the window's `when` conditions would refuse. Commands no plugin
 * declares are left out, along with the separators and menus that leaves
 * empty.
 */
export function buildMenuTemplate(
	menus: readonly AppMenuNode[],
	commands: MenuCommands,
	platform: KeyboardPlatform,
): MenuItemConstructorOptions[] {
	return tidy(menus.flatMap((node) => toItem(node, commands, platform)));
}

function toItem(
	node: AppMenuNode,
	commands: MenuCommands,
	platform: KeyboardPlatform,
): MenuItemConstructorOptions[] {
	switch (node.type) {
		case "separator":
			return [{ type: "separator" }];
		case "role": {
			const accelerator = node.chord ? acceleratorFor(node.chord, platform) : undefined;
			return [{ role: node.role, ...(accelerator ? { accelerator } : {}) }];
		}
		case "command": {
			const title = commands.title(node.command);
			if (title === undefined) return [];
			const chord = commands.chord(node.command);
			const accelerator = chord ? acceleratorFor(chord, platform) : undefined;
			return [
				{
					label: node.label ?? title,
					enabled: node.enabled ?? true,
					...(accelerator ? { accelerator, registerAccelerator: false } : {}),
					click: () => commands.run(node.command),
				},
			];
		}
		case "submenu": {
			const items = tidy(node.items.flatMap((child) => toItem(child, commands, platform)));
			return items.length === 0 ? [] : [{ label: node.label, submenu: items }];
		}
	}
}

/** Drops leading, trailing and repeated separators. */
function tidy(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
	const result: MenuItemConstructorOptions[] = [];
	for (const item of items) {
		const isSeparator = item.type === "separator";
		if (isSeparator && (result.length === 0 || result.at(-1)?.type === "separator")) continue;
		result.push(item);
	}
	if (result.at(-1)?.type === "separator") result.pop();
	return result;
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
	ArrowLeft: "Left",
	ArrowRight: "Right",
	ArrowUp: "Up",
	ArrowDown: "Down",
	Tab: "Tab",
	Enter: "Enter",
	Escape: "Esc",
	Backspace: "Backspace",
	Delete: "Delete",
	Space: "Space",
	PageUp: "PageUp",
	PageDown: "PageDown",
	Home: "Home",
	End: "End",
	Slash: "/",
	Backslash: "\\",
	BracketLeft: "[",
	BracketRight: "]",
	Backquote: "`",
	Comma: ",",
	Period: ".",
	Semicolon: ";",
	Quote: "'",
	Minus: "-",
	Equal: "=",
	NumpadAdd: "numadd",
	NumpadSubtract: "numsub",
	NumpadMultiply: "nummult",
	NumpadDivide: "numdiv",
	NumpadDecimal: "numdec",
};

function acceleratorKey(code: string): string | undefined {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
	if (/^F([1-9]|1[0-2])$/.test(code)) return code;
	return NAMED_KEYS[code];
}

/** An Electron accelerator for a canonical chord, or undefined when Electron can't name its key. */
export function acceleratorFor(chord: string, platform: KeyboardPlatform): string | undefined {
	const parsed = parseChord(chord);
	const key = parsed && acceleratorKey(parsed.code);
	if (!parsed || !key) return undefined;
	return [
		...(parsed.ctrl ? ["Ctrl"] : []),
		...(parsed.alt ? ["Alt"] : []),
		...(parsed.shift ? ["Shift"] : []),
		...(parsed.meta ? [platform === "mac" ? "Cmd" : "Super"] : []),
		key,
	].join("+");
}
