import {
	KernelApp,
	KernelKeybindings,
	mixedSeriesOverrides,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import manifest from "../../../plugin.json";
import { adoptionStore } from "../storage/stores";

const OWN = "kilo.work-sessions";

/** kilo.workbench's commands whose id changed (the rest kept theirs). */
const RENAMED_WORKBENCH_COMMANDS: Readonly<Record<string, string>> = {
	"new-session": "new-work-session",
	"new-empty-session": "new-empty-work-session",
	search: "search-work-sessions",
	"next-session": "next-work-session",
	"previous-session": "previous-work-session",
	"next-attention-session": "next-attention-work-session",
	"toggle-pin-session": "toggle-pin-work-session",
	"session-1": "work-session-1",
	"session-2": "work-session-2",
	"session-3": "work-session-3",
	"session-4": "work-session-4",
	"session-5": "work-session-5",
	"session-6": "work-session-6",
	"session-7": "work-session-7",
	"session-8": "work-session-8",
	"session-last": "work-session-last",
	"open-session": "open-work-session",
	"show-sessions-view": "show-work-sessions-view",
};

/** kilo.workbench's commands that kept their id. */
const KEPT_WORKBENCH_COMMANDS = [
	"new-pane",
	"close-pane",
	"new-group-right",
	"new-group-below",
	"next-pane",
	"previous-pane",
	"toggle-carousel",
	"pane-1",
	"pane-2",
	"pane-3",
	"pane-4",
	"pane-5",
	"pane-6",
	"pane-7",
	"pane-8",
	"pane-last",
];

const RENAMED_WORKSPACES_COMMANDS: Readonly<Record<string, string>> = {
	add: "add-workspace",
	manage: "manage-workspaces",
	edit: "edit-workspace",
	delete: "delete-workspace",
};

/**
 * Every command key of kilo.workbench and kilo.workspaces (from their last
 * manifests) → the kilo.work-sessions command that replaced it.
 */
export const LEGACY_COMMAND_KEYS: Readonly<Record<string, string>> = Object.fromEntries([
	...Object.entries(RENAMED_WORKBENCH_COMMANDS).map(([from, to]) => [
		`kilo.workbench/${from}`,
		`${OWN}/${to}`,
	]),
	...KEPT_WORKBENCH_COMMANDS.map((id) => [`kilo.workbench/${id}`, `${OWN}/${id}`]),
	...Object.entries(RENAMED_WORKSPACES_COMMANDS).map(([from, to]) => [
		`kilo.workspaces/${from}`,
		`${OWN}/${to}`,
	]),
]);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One-time migrations of the shortcuts people set, each tried again next launch until it succeeds. */
export async function activateKeybindings(sdk: PluginSdk): Promise<void> {
	await moveLegacyKeybindings(sdk);
	await resetMixedNumberSeries(sdk);
}

/**
 * Moves the shortcuts people set for kilo.workbench's and kilo.workspaces'
 * commands to the kilo.work-sessions commands that replaced them, once: an
 * override (a chord, or an unbinding) under an old key is set on the new key
 * unless the new key has one already, and the old key is reset. Without
 * `kernel/keybindings` nothing moves and it is tried again next launch.
 */
async function moveLegacyKeybindings(sdk: PluginSdk): Promise<void> {
	const adoption = adoptionStore(sdk);
	if (adoption.snapshot().keybindingsMoved) return;
	const keybindings = sdk.domainObjects.get(KernelKeybindings);
	if (!keybindings) return;
	try {
		const { overrides } = keybindings.getState();
		for (const [legacy, command] of Object.entries(LEGACY_COMMAND_KEYS)) {
			if (!(legacy in overrides)) continue;
			if (!(command in overrides)) {
				await keybindings.methods.setOverride({ command, chord: overrides[legacy] ?? null });
			}
			await keybindings.methods.reset({ command: legacy });
		}
		adoption.set({ keybindingsMoved: true });
	} catch (error) {
		sdk.logger.warn(
			`Could not move keyboard shortcuts; will try again next launch: ${errorText(error)}`,
		);
	}
}

const OWN_COMMANDS = manifest.contributes.extensions["kernel/command"].map(
	({ id, ...metadata }) => ({ key: `${OWN}/${id}`, metadata }),
);

/**
 * The tab and session number shortcuts became one series each, changed as
 * one row in Settings → Shortcuts. Once, after the legacy move, resets a
 * series whose numbers were changed one at a time; later changes to a
 * series never reset what people set.
 */
async function resetMixedNumberSeries(sdk: PluginSdk): Promise<void> {
	const adoption = adoptionStore(sdk);
	const { keybindingsMoved, numberSeriesReset } = adoption.snapshot();
	// Waits for the legacy move, which may bring per-number overrides with it.
	if (numberSeriesReset || !keybindingsMoved) return;
	const keybindings = sdk.domainObjects.get(KernelKeybindings);
	const platform = sdk.domainObjects.get(KernelApp)?.getState().platform;
	if (!keybindings || !platform) return;
	try {
		const mixed = mixedSeriesOverrides({
			commands: OWN_COMMANDS,
			overrides: keybindings.getState().overrides,
			platform,
		});
		await keybindings.methods.update({ reset: mixed });
		if (mixed.length > 0) {
			sdk.logger.info(`Reset number shortcuts changed one at a time: ${mixed.join(", ")}`);
		}
		adoption.set({ numberSeriesReset: true });
	} catch (error) {
		sdk.logger.warn(
			`Could not reset number shortcuts; will try again next launch: ${errorText(error)}`,
		);
	}
}
