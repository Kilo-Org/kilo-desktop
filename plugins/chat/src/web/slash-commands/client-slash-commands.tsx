import { useAui } from "@assistant-ui/react";
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

import { KernelCommand } from "@kilo-desktop/kernel";
import { useExtensions, useKernel } from "@kilo-desktop/kernel/web";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { ClientSlashCommand, type ClientSlashCommandContext } from "../../contracts";
import { useComposerContext } from "../composer/composer-actions";
import { useChatConnection } from "../runtime/chat-connection";
import type { PromptSelection } from "../selection/composer-selection";
import { isLeadingSlashQuery, parseSlashDraft } from "./kilo-slash-command";
import {
	mergeSlashCommands,
	resolveTypedSlash,
	type ClientSlashEntry,
	type SlashMenuCommand,
} from "./merge-slash-commands";
import { useKiloCommandCatalog } from "./use-kilo-command-catalog";

export interface SlashCommandsState {
	/** The `/` menu: client commands, then the server's. */
	readonly commands: readonly SlashMenuCommand[];
	/** The server's commands are still loading; client commands are already listed. */
	readonly isServerPending: boolean;
}

/**
 * The chat folder's `/` commands: the kernel commands kilo.chat and other
 * plugins place in the menu (while each is available: implemented, its
 * `when` holding) with the server's.
 */
export function useSlashCommands(directory: string | null): SlashCommandsState {
	const { connection } = useChatConnection();
	const catalog = useKiloCommandCatalog(connection, directory ?? undefined);
	const placements = useExtensions(ClientSlashCommand);
	const available = useExtensions(KernelCommand);
	const client = useMemo(() => {
		const titles = new Map<string, string>(
			available.map((command) => [command.key, command.metadata.title]),
		);
		return placements.flatMap((placement): ClientSlashEntry[] => {
			const title = titles.get(placement.metadata.command);
			if (title === undefined) return [];
			return [
				{
					key: placement.key,
					name: placement.metadata.name,
					description: placement.metadata.description ?? title,
					aliases: placement.metadata.aliases,
				},
			];
		});
	}, [placements, available]);
	const commands = useMemo(
		() => mergeSlashCommands(client, catalog.data ?? []),
		[client, catalog.data],
	);
	return { commands, isServerPending: catalog.isPending };
}

/** The server's command names, as a prompt is sent with them; client commands never reach the server. */
export function serverCommandNames(commands: readonly SlashMenuCommand[]): string[] {
	return commands.filter((command) => !command.clientKey).map((command) => command.id);
}

const SelectionContext = createContext<(() => PromptSelection) | null>(null);

/** Hands client slash commands what the pane's next prompt would be sent with. */
export function ClientSlashSelectionProvider({
	getSelection,
	children,
}: {
	readonly getSelection: () => PromptSelection;
	readonly children: ReactNode;
}) {
	return <SelectionContext.Provider value={getSelection}>{children}</SelectionContext.Provider>;
}

function toCommandSelection(selection: PromptSelection): ClientSlashCommandContext["selection"] {
	return {
		...(selection.agent ? { agent: selection.agent } : {}),
		...(selection.model
			? { model: { providerID: selection.model.providerID, modelID: selection.model.modelID } }
			: {}),
		...(selection.variant ? { variant: selection.variant } : {}),
	};
}

/**
 * Runs a placed command by its placement's key, with the composer's context
 * as it is at that moment: clears the composer's text (and, for a typed
 * send, its attachments), then executes the placement's `kernel/command`
 * with the `ClientSlashCommandContext` as its argument. A command that fails
 * here is reported in a toast rather than breaking the composer; one main
 * forwards to another window reports its failure there.
 */
export function useRunClientSlashCommand(): (
	key: string,
	options?: { readonly clearAttachments?: boolean },
) => void {
	const aui = useAui();
	const kernel = useKernel();
	const composer = useComposerContext();
	const latestComposer = useRef(composer);
	latestComposer.current = composer;
	const getSelection = useContext(SelectionContext);
	const placements = useExtensions(ClientSlashCommand);
	const latestPlacements = useRef(placements);
	latestPlacements.current = placements;

	return useCallback(
		(key, options) => {
			const placement = latestPlacements.current.find((entry) => entry.key === key);
			if (!placement) return;
			const { command, name } = placement.metadata;
			aui.composer.setText("");
			if (options?.clearAttachments) void aui.composer.clearAttachments().catch(() => undefined);
			const context: ClientSlashCommandContext = {
				...latestComposer.current,
				selection: toCommandSelection(getSelection?.() ?? {}),
				running: aui.thread.getState().isRunning,
			};
			kernel.commands.execute(command, context).catch((error: unknown) => {
				console.error(`[kilo.chat] /${name} failed`, error);
				toast.error(`/${name} failed`, {
					description: error instanceof Error ? error.message : undefined,
				});
			});
		},
		[aui, kernel, getSelection],
	);
}

/**
 * Sending a draft that names a client command (`/compact`, `/smol now`) runs
 * it instead of sending it, clearing the whole draft. Returns whether it
 * did. Enter on a draft that is only `/name` belongs to the open `/` menu,
 * which picks its highlighted row, so `fromEnter` leaves that case alone.
 */
export function useRunTypedClientSlashCommand(
	commands: readonly SlashMenuCommand[],
): (options: { readonly fromEnter: boolean }) => boolean {
	const aui = useAui();
	const run = useRunClientSlashCommand();
	const latestCommands = useRef(commands);
	latestCommands.current = commands;
	return useCallback(
		({ fromEnter }) => {
			const text = aui.composer.getState().text;
			if (fromEnter && isLeadingSlashQuery(text)) return false;
			const draft = parseSlashDraft(text);
			if (!draft) return false;
			const target = resolveTypedSlash(draft.command, latestCommands.current);
			if (target?.kind !== "client") return false;
			run(target.key, { clearAttachments: true });
			return true;
		},
		[aui, run],
	);
}
