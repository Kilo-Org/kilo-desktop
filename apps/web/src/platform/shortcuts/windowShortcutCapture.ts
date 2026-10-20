import type { LocalApi, ShortcutBinding } from "@kilo-desktop/contracts";
import { chordFromKeyboardEvent, serializeChord } from "@kilo-desktop/feature-sdk";

type ShortcutsApi = LocalApi["shortcuts"];

/** Browser-mode capture. Blind to cross-origin iframes, which is why Electron captures in main. */
export function createWindowShortcutCapture(target: EventTarget = globalThis): ShortcutsApi {
	let bindings = new Map<string, ShortcutBinding>();
	const triggered = new Set<(event: { commandId: string; chord: string }) => void>();
	let attached = false;

	const onKeyDown = (raw: Event) => {
		const event = raw as KeyboardEvent;
		const chord = chordFromKeyboardEvent(event);
		const binding = chord ? bindings.get(serializeChord(chord)) : undefined;
		if (!binding) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat && !binding.repeatable) return;
		for (const listener of triggered) {
			listener({ commandId: binding.commandId, chord: binding.chord });
		}
	};

	const attach = () => {
		if (attached) return;
		attached = true;
		target.addEventListener("keydown", onKeyDown, { capture: true });
	};

	return {
		sync({ bindings: next }) {
			bindings = new Map(next.map((binding) => [binding.chord, binding]));
			attach();
		},
		onTriggered(listener) {
			triggered.add(listener);
			attach();
			return () => triggered.delete(listener);
		},
	};
}
