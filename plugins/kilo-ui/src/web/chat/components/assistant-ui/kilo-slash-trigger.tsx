import {
	unstable_useSlashCommandAdapter,
	useAuiState,
	type Unstable_SlashCommand,
	type Unstable_TriggerItem,
} from "@assistant-ui/react";
import { SlashIcon } from "lucide-react";
import { useMemo, type FC } from "react";

import { useChatConnection } from "../../connection/ChatConnectionContext.js";
import {
	groupKiloCommandsBySource,
	isLeadingSlashQuery,
	mapKiloCommand,
	type KiloSlashCommandFields,
} from "../../slash-commands/kilo-slash-command.js";
import { SLASH_CATEGORY_ICONS } from "../../slash-commands/kilo-slash-icons.js";
import { useKiloCommandCatalog } from "../../slash-commands/use-kilo-command-catalog.js";
import { useKiloSlashFormatter } from "../../slash-commands/use-kilo-slash-formatter.js";
import { useWorkspaceDirectory } from "../../use-workspace-directory.js";
import { ComposerTriggerPopover } from "./elements/composer-trigger-popover.aui.js";

export const KiloSlashTrigger: FC = () => {
	const { connection } = useChatConnection();
	const workspaceDirectory = useWorkspaceDirectory();
	const directory = workspaceDirectory ?? connection?.globalDirectory;
	const catalog = useKiloCommandCatalog(connection, directory);
	const formatter = useKiloSlashFormatter();
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
