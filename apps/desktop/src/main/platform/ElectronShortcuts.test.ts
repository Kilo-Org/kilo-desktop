import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registry } = vi.hoisted(() => ({ registry: new Map<number, unknown>() }));
const appEvents = new EventEmitter();

vi.mock("electron", () => ({
	app: {
		on: (event: string, listener: (...args: unknown[]) => void) => appEvents.on(event, listener),
		off: (event: string, listener: (...args: unknown[]) => void) => appEvents.off(event, listener),
	},
	webContents: {
		getAllWebContents: () => [...registry.values()],
		fromId: (id: number) => registry.get(id),
	},
}));

import type { ShortcutBinding } from "./ElectronShortcuts.js";

import {
	ElectronShortcuts,
	resolveShortcutInput,
	type ShortcutInput,
} from "./ElectronShortcuts.js";

const table = new Map<string, ShortcutBinding>([
	["Meta+Digit1", { chord: "Meta+Digit1", commandId: "kilo.workbench/tab-1" }],
	["Ctrl+Tab", { chord: "Ctrl+Tab", commandId: "kilo.workbench/next-session", repeatable: true }],
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

class FakeWebContents extends EventEmitter {
	destroyed = false;
	ignoreMenuShortcuts = false;
	readonly sent: { channel: string; payload: unknown }[] = [];
	readonly inputEvents: unknown[] = [];

	constructor(
		readonly id: number,
		readonly hostWebContents?: FakeWebContents,
	) {
		super();
	}

	isDestroyed(): boolean {
		return this.destroyed;
	}

	setIgnoreMenuShortcuts(ignore: boolean): void {
		this.ignoreMenuShortcuts = ignore;
	}

	send(channel: string, payload: unknown): void {
		this.sent.push({ channel, payload });
	}

	sendInputEvent(event: unknown): void {
		this.inputEvents.push(event);
	}

	/** Emits `before-input-event` and reports whether a listener consumed the key. */
	press(keyInput: ShortcutInput): boolean {
		let prevented = false;
		this.emit("before-input-event", { preventDefault: () => (prevented = true) }, keyInput);
		return prevented;
	}
}

function register(contents: FakeWebContents): FakeWebContents {
	registry.set(contents.id, contents);
	return contents;
}

const metaDigit1 = input({ key: "1", code: "Digit1", meta: true });

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
		).toEqual({ action: "dispatch", commandId: "kilo.workbench/next-session", chord: "Ctrl+Tab" });
	});

	it("passes key-ups, unbound chords, and unsupported keys through", () => {
		expect(resolveShortcutInput(table, { ...metaDigit1, type: "keyUp" })).toEqual({
			action: "pass",
		});
		expect(resolveShortcutInput(table, input({ code: "Digit2", meta: true }))).toEqual({
			action: "pass",
		});
		expect(resolveShortcutInput(table, input({ code: "MetaLeft", meta: true }))).toEqual({
			action: "pass",
		});
	});
});

describe("ElectronShortcuts", () => {
	let uninstall: (() => void) | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		uninstall?.();
		uninstall = undefined;
		registry.clear();
		appEvents.removeAllListeners();
		vi.useRealTimers();
	});

	function install(): ElectronShortcuts {
		const shortcuts = new ElectronShortcuts();
		uninstall = shortcuts.install();
		return shortcuts;
	}

	it("dispatches a bound chord to the host renderer and consumes the key", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()]);

		expect(host.press(metaDigit1)).toBe(true);
		expect(host.sent).toEqual([
			{
				channel: "shortcuts:triggered",
				payload: { commandId: "kilo.workbench/tab-1", chord: "Meta+Digit1" },
			},
		]);
	});

	it("re-sends the held modifier after dispatch so the page sees its release", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()]);

		host.press(metaDigit1);
		expect(host.inputEvents).toEqual([]);
		vi.runAllTimers();

		expect(host.inputEvents).toEqual([{ type: "keyDown", keyCode: "Meta", modifiers: ["meta"] }]);
	});

	it("skips the modifier resend when the contents was destroyed meanwhile", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()]);

		host.press(metaDigit1);
		host.destroyed = true;
		vi.runAllTimers();

		expect(host.inputEvents).toEqual([]);
	});

	it("does not resend a modifier for unmodified bindings", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [{ chord: "F5", commandId: "reload" }]);

		expect(host.press(input({ key: "F5", code: "F5" }))).toBe(true);
		vi.runAllTimers();

		expect(host.sent).toHaveLength(1);
		expect(host.inputEvents).toEqual([]);
	});

	it("routes keys from guest contents created later to their host's table", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()]);
		const guest = new FakeWebContents(2, host);
		appEvents.emit("web-contents-created", {}, guest);

		expect(guest.press(metaDigit1)).toBe(true);
		expect(host.sent).toHaveLength(1);
		expect(guest.sent).toEqual([]);
	});

	it("swallows a non-repeatable auto-repeat without dispatching", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()]);

		expect(host.press({ ...metaDigit1, isAutoRepeat: true })).toBe(true);
		expect(host.sent).toEqual([]);
	});

	it("lets unmatched keys and unsynced contents pass through", () => {
		const host = register(new FakeWebContents(1));
		const unsynced = register(new FakeWebContents(2));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()]);

		expect(host.press(input({ code: "KeyA" }))).toBe(false);
		expect(unsynced.press(metaDigit1)).toBe(false);
		expect(host.sent).toEqual([]);
	});

	it("ignores keys once the host is destroyed", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()]);
		host.destroyed = true;

		expect(host.press(metaDigit1)).toBe(false);
	});

	it.each(["destroyed", "did-navigate", "render-process-gone"])(
		"drops the host's table on %s",
		(event) => {
			const host = register(new FakeWebContents(1));
			const shortcuts = install();
			shortcuts.sync(1, [...table.values()]);

			host.emit(event);

			expect(host.press(metaDigit1)).toBe(false);
		},
	);

	it("replaces the table on re-sync and toggles menu shortcuts while recording", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		shortcuts.sync(1, [...table.values()], true);
		expect(host.ignoreMenuShortcuts).toBe(true);

		shortcuts.sync(1, [{ chord: "F5", commandId: "reload" }]);

		expect(host.ignoreMenuShortcuts).toBe(false);
		expect(host.press(metaDigit1)).toBe(false);
		expect(host.listenerCount("destroyed")).toBe(1);
	});

	it("ignores syncs from unknown senders", () => {
		const shortcuts = install();
		expect(() => shortcuts.sync(404, [...table.values()])).not.toThrow();
	});

	it("attaches one listener per contents and stops capturing after uninstall", () => {
		const host = register(new FakeWebContents(1));
		const shortcuts = install();
		appEvents.emit("web-contents-created", {}, host);
		expect(host.listenerCount("before-input-event")).toBe(1);
		shortcuts.sync(1, [...table.values()]);

		uninstall?.();
		uninstall = undefined;

		expect(appEvents.listenerCount("web-contents-created")).toBe(0);
		expect(host.press(metaDigit1)).toBe(false);
	});
});
