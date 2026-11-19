import { useSlashCommands, type SlashCommandsState } from "../slash-commands/client-slash-commands";
import { kiloSlashFormatter } from "../slash-commands/use-kilo-slash-formatter";
import { useComposerContext } from "./composer-actions";
import { combineFormatters, composerPlaceholder, createMentionFormatter } from "./mention-codec";
import { mentionIcons, useMentionSources } from "./mention-triggers";

const isMentionType = (type: string) => type.startsWith("m_");

/**
 * What a Lexical composer input needs to write and read chips: the `/`
 * commands, the mention sources, the formatter combining both, and the
 * mention menus' icons and context. `promptCommandsOnly` drops client
 * commands, which act on the pane rather than producing a prompt.
 */
export function useComposerInputWiring(options: { readonly promptCommandsOnly?: boolean } = {}) {
	const { promptCommandsOnly = false } = options;
	const context = useComposerContext();
	const { commands: allCommands, isServerPending } = useSlashCommands(context.directory);
	const sources = useMentionSources();
	// Past the hooks, so the compiler caches each value on its inputs.
	const slash: SlashCommandsState = {
		commands: promptCommandsOnly
			? allCommands.filter((command) => !command.clientKey)
			: allCommands,
		isServerPending,
	};
	const formatter = combineFormatters(
		kiloSlashFormatter(slash.commands),
		createMentionFormatter(sources),
		isMentionType,
	);
	return {
		slash,
		sources,
		formatter,
		placeholder: composerPlaceholder(sources),
		icons: mentionIcons(sources),
		mentionContext: {
			workSessionId: context.workSessionId,
			directory: context.directory,
			workspaceId: context.workspaceId,
			workspaceFolders: context.workspaceFolders,
		},
	};
}
