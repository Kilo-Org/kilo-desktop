import {
	unstable_useSlashCommandAdapter,
	useAuiState,
	type Unstable_DirectiveFormatter,
	type Unstable_SlashCommand,
	type Unstable_TriggerItem,
} from "@assistant-ui/react";
import { SlashIcon } from "lucide-react";
import { useMemo, type FC } from "react";

import { useChatConnection } from "../runtime/chat-connection";
import {
	groupKiloCommandsBySource,
	isLeadingSlashQuery,
	mapKiloCommand,
	type KiloSlashCommandFields,
} from "../slash-commands/kilo-slash-command";
import { SLASH_CATEGORY_ICONS } from "../slash-commands/kilo-slash-icons";
import { useKiloCommandCatalog } from "../slash-commands/use-kilo-command-catalog";
import { ComposerTriggerPopover } from "./trigger-popover";

/** The `/` menu: Kilo's commands, skills and MCP prompts for the chat's folder. */
export const KiloSlashTrigger: FC<{
	directory: string | null;
	formatter: Unstable_DirectiveFormatter;
}> = ({ directory, formatter }) => {
	const { connection } = useChatConnection();
	const catalog = useKiloCommandCatalog(connection, directory ?? undefined);
	const composerText = useAuiState((s) => s.composer.text);

	const fields = useMemo(() => (catalog.data ?? []).map(mapKiloCommand), [catalog.data]);
	const commands = useMemo<Unstable_SlashCommand[]>(
		() =>
			fields.map((command) => ({
				...command,
				execute: noop,
			})),
		[fields],
	);
	const groups = useMemo(() => groupKiloCommandsBySource(fields), [fields]);

	const slash = unstable_useSlashCommandAdapter({
		commands,
		iconMap: SLASH_CATEGORY_ICONS,
		fallbackIcon: SlashIcon,
	});

	const adapter = useMemo(() => {
		const search = (query: string) => (slash.adapter.search?.(query) ?? []).map(withSourceType);
		if (groups.length < 2) return { ...slash.adapter, search };
		const itemsByCategory = new Map(
			groups.map((group) => [group.id, group.items.map(toTriggerItem)] as const),
		);
		return {
			categories: () => groups.map(({ id, label }) => ({ id, label })),
			categoryItems: (categoryId) => itemsByCategory.get(categoryId) ?? [],
			search,
		};
	}, [groups, slash.adapter]);

	return (
		<ComposerTriggerPopover
			char="/"
			{...slash}
			adapter={isLeadingSlashQuery(composerText) ? adapter : undefined}
			action={{ ...slash.action, formatter }}
			isLoading={catalog.isPending}
		/>
	);
};

function noop(): void {}

function toTriggerItem(command: KiloSlashCommandFields): Unstable_TriggerItem {
	return {
		id: command.id,
		type: command.icon,
		label: command.label ?? command.id,
		...(command.description ? { description: command.description } : {}),
		...(command.icon ? { metadata: { icon: command.icon } } : {}),
	};
}

function withSourceType(item: Unstable_TriggerItem): Unstable_TriggerItem {
	const icon = item.metadata?.icon;
	return typeof icon === "string" ? { ...item, type: icon } : item;
}
