import { useEffect, useMemo, useRef, useState } from "react";

import {
	detectKeyboardPlatform,
	EFFECTIVE_KEYBINDINGS_STORE,
	type StoreHandle,
} from "@kilo-desktop/feature-sdk";
import {
	useCommand,
	useCommands,
	useFeatureSystem,
	type FeatureSystem,
} from "@kilo-desktop/sdk-react";

import { useLocalApi } from "@/platform/LocalApiProvider";

import { commandForTrigger, computeEffectiveKeybindings } from "./effective-keybindings";
import { useKeybindingOverrides } from "./keybinding-overrides";
import { rememberCommands } from "./known-commands";
import { useShortcutRecording } from "./shortcut-recording";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { SHELL_FEATURE_ID } from "./shell-feature";

interface ShellKeyboardStores {
	readonly keybindings: StoreHandle<Readonly<Record<string, readonly string[]>>>;
}

// `data-open` skips a dialog still animating out, so a shortcut pressed right after Esc works.
const MODAL_SELECTOR =
	'[data-slot="dialog-content"][data-open], [data-slot="alert-dialog-content"][data-open]';

const storesBySystem = new WeakMap<FeatureSystem, ShellKeyboardStores>();

// Registered once per feature system — not in an effect — so StrictMode
// remounts never register the stores twice.
function shellKeyboardStores(system: FeatureSystem): ShellKeyboardStores {
	let stores = storesBySystem.get(system);
	if (!stores) {
		const { stateBroker } = system.services;
		const [owner, keybindingsName] = EFFECTIVE_KEYBINDINGS_STORE.split(".") as [string, string];
		stores = {
			keybindings: stateBroker.register<Readonly<Record<string, readonly string[]>>>(
				owner,
				keybindingsName,
				{},
			),
		};
		storesBySystem.set(system, stores);
	}
	return stores;
}

/**
 * Shell owner of this window's shortcuts: merges command defaults with user
 * overrides, syncs them to the host's capture, and runs what it reports back.
 */
export function ShortcutsHost() {
	const api = useLocalApi();
	const system = useFeatureSystem();
	const commands = useCommands();
	const overrides = useKeybindingOverrides();
	const platform = useMemo(detectKeyboardPlatform, []);
	const stores = shellKeyboardStores(system);
	const effective = useMemo(
		() => computeEffectiveKeybindings(commands, overrides, platform),
		[commands, overrides, platform],
	);
	const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
	const isMainWindow = api.shell.windowRole === "main";

	const recording = useShortcutRecording();

	useEffect(() => rememberCommands(commands), [commands]);

	useEffect(() => {
		stores.keybindings.set(effective.byCommand);
		api.shortcuts.sync({ bindings: recording ? [] : effective.bindings, recording });
	}, [api, effective, recording, stores]);

	useEffect(() => () => api.shortcuts.sync({ bindings: [] }), [api]);

	const latest = useRef({ commands, byCommand: effective.byCommand });
	latest.current = { commands, byCommand: effective.byCommand };

	useEffect(
		() =>
			api.shortcuts.onTriggered((trigger) => {
				const { commands: live, byCommand } = latest.current;
				const modalOpen = document.querySelector(MODAL_SELECTOR) !== null;
				const commandId = commandForTrigger(live, byCommand, trigger, modalOpen);
				if (!commandId) return;
				void system.services.commandRegistry.execute(commandId).catch((error: unknown) => {
					console.warn(`[shortcuts] ${commandId} failed`, error);
				});
			}),
		[api, system],
	);

	useCommand(
		SHELL_FEATURE_ID,
		{
			id: "show-shortcuts",
			label: "Show keyboard shortcuts",
			group: "App",
			keybinding: "Mod+/",
			order: 10,
			handler: () => setCheatSheetOpen((open) => !open),
		},
		isMainWindow,
	);

	useCommand(
		SHELL_FEATURE_ID,
		{
			id: "close-window",
			label: "Close window",
			group: "App",
			keybinding: { mac: "Mod+W", default: "Ctrl+Shift+W" },
			order: 40,
			handler: () => globalThis.close(),
		},
		!isMainWindow,
	);

	return <KeyboardShortcutsDialog open={cheatSheetOpen} onOpenChange={setCheatSheetOpen} />;
}
