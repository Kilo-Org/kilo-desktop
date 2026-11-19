import {
	// React Compiler only treats `use*` names as hooks; an `unstable_` prefix would be memoized like a plain call.
	unstable_useSlashCommandAdapter as useSlashCommandAdapter,
	useAuiState,
	type Unstable_DirectiveFormatter,
	type Unstable_SlashCommand,
	type Unstable_TriggerItem,
} from "@assistant-ui/react";
import type { Unstable_TriggerAdapter } from "@assistant-ui/core";
import { SlashIcon } from "lucide-react";
import type { FC } from "react";

import { isLeadingSlashQuery } from "../slash-commands/kilo-slash-command";
import { SLASH_CATEGORY_ICONS } from "../slash-commands/kilo-slash-icons";
import {
	groupSlashCommands,
	searchSlashCommands,
	type SlashMenuCommand,
} from "../slash-commands/merge-slash-commands";
import {
	useRunClientSlashCommand,
	type SlashCommandsState,
} from "../slash-commands/client-slash-commands";
import { ComposerTriggerPopover } from "./trigger-popover";

/**
 * The `/` menu: client commands (Actions) and Kilo's commands, skills and
 * MCP prompts for the chat's folder. Picking a server command leaves its chip
 * for the person to add arguments and send; picking a client command runs it
 * and clears the draft.
 */
export const KiloSlashTrigger: FC<{
	slash: SlashCommandsState;
	formatter: Unstable_DirectiveFormatter;
}> = ({ slash, formatter }) => {
	const { commands, isServerPending } = slash;
	const composerText = useAuiState((s) => s.composer.text);
	const runClientCommand = useRunClientSlashCommand();

	const menu = useSlashCommandAdapter({
		commands: executableSlashCommands(commands, runClientCommand),
		iconMap: SLASH_CATEGORY_ICONS,
		fallbackIcon: SlashIcon,
	});
	// Computed past the adapter hook from `commands`, so it caches on its own inputs.
	const adapter = slashMenuAdapter(commands);

	return (
		<ComposerTriggerPopover
			char="/"
			{...menu}
			adapter={isLeadingSlashQuery(composerText) ? adapter : undefined}
			action={{ ...menu.action, formatter }}
			isLoading={isServerPending}
		/>
	);
};

function noop(): void {}

function executableSlashCommands(
	commands: readonly SlashMenuCommand[],
	runClientCommand: (key: string) => void,
): Unstable_SlashCommand[] {
	return commands.map((command) => {
		const { clientKey } = command;
		return {
			id: command.id,
			label: command.label,
			...(command.description ? { description: command.description } : {}),
			icon: command.category,
			execute: clientKey ? () => runClientCommand(clientKey) : noop,
		};
	});
}

/** Searches every command, browsable by category once there are several categories. */
function slashMenuAdapter(commands: readonly SlashMenuCommand[]): Unstable_TriggerAdapter {
	const search = (query: string) => searchSlashCommands(query, commands).map(toTriggerItem);
	const groups = groupSlashCommands(commands);
	if (groups.length < 2) return { categories: () => [], categoryItems: () => [], search };
	const itemsByCategory = new Map(
		groups.map((group) => [group.id as string, group.items.map(toTriggerItem)] as const),
	);
	return {
		categories: () => groups.map(({ id, label }) => ({ id, label })),
		categoryItems: (categoryId) => itemsByCategory.get(categoryId) ?? [],
		search,
	};
}

function toTriggerItem(command: SlashMenuCommand): Unstable_TriggerItem {
	return {
		id: command.id,
		type: command.category,
		label: command.label,
		...(command.description ? { description: command.description } : {}),
		metadata: { icon: command.category },
	};
}
