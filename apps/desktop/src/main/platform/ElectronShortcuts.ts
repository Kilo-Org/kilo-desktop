import { app, webContents as allWebContents, type Input, type WebContents } from "electron";

import { chordFromKeyboardEvent, serializeChord } from "@kilo-desktop/kernel";

/** One app-wide shortcut: a canonical chord (see `serializeChord`) bound to a command id. */
export interface ShortcutBinding {
	readonly chord: string;
	readonly commandId: string;
	readonly repeatable?: boolean;
}

/**
 * App-wide shortcut capture. Renderers push their window's bindings
 * (`shortcuts:sync`); main matches keys on every WebContents, including
 * iframes and `<webview>` guests that a renderer listener can't see.
 *
 * Invariants: a table belongs to its host WebContents and is dropped on
 * navigation, crash, or destroy; a matched key never reaches the page or the
 * menu, auto-repeats included; unmatched keys pass through.
 */
export class ElectronShortcuts {
	readonly #tables = new Map<number, Map<string, ShortcutBinding>>();
	readonly #attached = new WeakSet<WebContents>();
	readonly #watched = new WeakSet<WebContents>();

	install(): () => void {
		const onCreated = (_event: Electron.Event, contents: WebContents) => this.#attach(contents);
		app.on("web-contents-created", onCreated);
		for (const contents of allWebContents.getAllWebContents()) this.#attach(contents);
		return () => {
			app.off("web-contents-created", onCreated);
			this.#tables.clear();
		};
	}

	sync(senderId: number, bindings: readonly ShortcutBinding[], recording = false): void {
		const sender = allWebContents.fromId(senderId);
		if (!sender) return;
		if (!this.#watched.has(sender)) {
			this.#watched.add(sender);
			const drop = () => this.#tables.delete(senderId);
			sender.on("destroyed", drop);
			sender.on("did-navigate", drop);
			sender.on("render-process-gone", drop);
		}
		sender.setIgnoreMenuShortcuts(recording);
		this.#tables.set(senderId, new Map(bindings.map((binding) => [binding.chord, binding])));
	}

	#attach(contents: WebContents): void {
		if (this.#attached.has(contents)) return;
		this.#attached.add(contents);
		contents.on("before-input-event", (event, input) => {
			const host = contents.hostWebContents ?? contents;
			const table = this.#tables.get(host.id);
			if (!table || host.isDestroyed()) return;
			const outcome = resolveShortcutInput(table, input);
			if (outcome.action === "pass") return;
			event.preventDefault();
			if (outcome.action === "dispatch") {
				host.send("shortcuts:triggered", { commandId: outcome.commandId, chord: outcome.chord });
				resumeKeyEvents(contents, input);
			}
		});
	}
}

/**
 * Consuming a keydown makes Chromium drop the page's key events until the next
 * keydown, so releasing a still-held modifier would never reach it (the
 * renderer's number-key hints stay up until that release). A synthetic keydown
 * of the held modifier ends the suppression. It is deferred so the consumed
 * key's own char event (e.g. "£" for ⌥3) is still dropped.
 */
function resumeKeyEvents(contents: WebContents, input: ShortcutInput): void {
	const modifiers = MODIFIER_FLAGS.filter((flag) => input[flag]);
	const keyCode = modifiers[0] && MODIFIER_KEY_CODES[modifiers[0]];
	if (!keyCode) return;
	setTimeout(() => {
		if (!contents.isDestroyed()) contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
	});
}

const MODIFIER_KEY_CODES = {
	meta: "Meta",
	control: "Control",
	alt: "Alt",
	shift: "Shift",
} as const;
const MODIFIER_FLAGS = ["meta", "control", "alt", "shift"] as const;

export type ShortcutInput = Pick<
	Input,
	"type" | "key" | "code" | "meta" | "control" | "alt" | "shift" | "isAutoRepeat"
>;

export type ShortcutInputOutcome =
	| { readonly action: "pass" }
	| { readonly action: "swallow" }
	| { readonly action: "dispatch"; readonly commandId: string; readonly chord: string };

export function resolveShortcutInput(
	table: ReadonlyMap<string, ShortcutBinding>,
	input: ShortcutInput,
): ShortcutInputOutcome {
	if (input.type !== "keyDown") return { action: "pass" };
	const chord = chordFromKeyboardEvent({
		code: input.code,
		metaKey: input.meta,
		ctrlKey: input.control,
		altKey: input.alt,
		shiftKey: input.shift,
	});
	const binding = chord ? table.get(serializeChord(chord)) : undefined;
	if (!binding) return { action: "pass" };
	if (input.isAutoRepeat && !binding.repeatable) return { action: "swallow" };
	return { action: "dispatch", commandId: binding.commandId, chord: binding.chord };
}
