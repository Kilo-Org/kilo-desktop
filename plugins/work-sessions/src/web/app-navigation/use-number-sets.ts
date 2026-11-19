import { KernelKeybindings, type KeyboardPlatform } from "@kilo-desktop/kernel";
import { useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";

import manifest from "../../../plugin.json";
import { WORK_SESSIONS_PLUGIN_ID } from "../../contracts";
import { collectNumberKeySeries, listRows, NUMBER_SETS, type NumberKeySeries } from "./number-sets";

/** The plugin's own commands with their default keybindings, as the sets read them. */
const OWN_COMMANDS = manifest.contributes.extensions["kernel/command"].map((command) => ({
	key: `${WORK_SESSIONS_PLUGIN_ID}/${command.id}`,
	scoped: false,
	metadata: command,
}));

const TITLES = new Map(OWN_COMMANDS.map((command) => [command.key, command.metadata.title]));

type Overrides = Readonly<Record<string, string | null>>;
const EMPTY_OVERRIDES: Overrides = {};
const selectOverrides = (state: { overrides: Overrides }) => state.overrides;

function seriesFor(overrides: Overrides, platform: KeyboardPlatform): NumberKeySeries[] {
	return collectNumberKeySeries(NUMBER_SETS, OWN_COMMANDS, overrides, platform);
}

/** The sets as the user has them now, with what they were read from. */
export function useNumberKeySeries() {
	const platform = useKernel().keyboard.platform;
	const overrides = useDomainObjectState(KernelKeybindings, selectOverrides) ?? EMPTY_OVERRIDES;
	return { series: seriesFor(overrides, platform), overrides, platform };
}

/** App Navigation's rows in the ⌘/ list (`kilo.shell/shortcuts-panel` `listRows`). */
export function appNavigationListRows(input: {
	readonly platform: KeyboardPlatform;
	readonly overrides: Overrides;
}) {
	return listRows(seriesFor(input.overrides, input.platform), TITLES, input.platform);
}
