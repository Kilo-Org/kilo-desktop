import { AuiIf, ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArrowUpIcon, MicIcon, SquareIcon } from "lucide-react";
import {
	useEffect,
	useRef,
	useState,
	type FC,
	type FormEvent,
	type KeyboardEvent,
	type MouseEvent,
} from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useApprovePlan } from "../plan/use-approve-plan";

import { useChatAgentSelection } from "../selection/ChatAgentSelectionContext";
import { cycleCatalogAgent, OPTIMISTIC_AGENT_CATALOG } from "../selection/agent-catalog";
import {
	useRunTypedClientSlashCommand,
	useSlashCommands,
} from "../slash-commands/client-slash-commands";
import { kiloSlashFormatter } from "../slash-commands/use-kilo-slash-formatter";
import { ComposerSubagentStrip } from "../subagents/ComposerSubagentStrip";
import { useSubagentActivity } from "../subagents/SubagentActivityContext";
import { ComposerAttachments } from "../thread/attachment";
import { ComposerTaskList } from "../tasks/ComposerTaskList";
import { ComposerQueue } from "../thread/composer-queue";
import { TooltipIconButton } from "../thread/tooltip-icon-button";
import { ComposerActionSlotView, useComposerContext } from "./composer-actions";
import { useComposerDragResize } from "./composer-height/use-composer-drag-resize";
import { ComposerResizeHandle } from "./composer-resize-handle";
import { KiloLexicalComposerInput } from "./kilo-lexical-composer-input";
import { KiloSlashTrigger } from "./kilo-slash-trigger";
import { combineFormatters, composerPlaceholder, createMentionFormatter } from "./mention-codec";
import {
	MentionIconsContext,
	MentionTriggers,
	mentionIcons,
	useMentionSources,
} from "./mention-triggers";

const isMentionType = (type: string) => type.startsWith("m_");

/**
 * The composer: queued prompts, attachments, the rich input with its `/` and
 * mention menus, the `composer-action` controls and send / queue / stop.
 * Shift+Tab cycles the agent, as origin's did. While the plan follow-up is
 * pending, sending refines the plan instead (Approve is on the plan card).
 */
export const Composer: FC<{ isDraft: boolean }> = ({ isDraft }) => {
	const aui = useAui();
	const context = useComposerContext();
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);
	const hasMessageQueue = useAuiState((s) => s.thread.capabilities.queue);
	const { agent, setAgent, catalog, isCatalogPending, isCatalogError } = useChatAgentSelection();
	const inputRef = useRef<HTMLDivElement>(null);
	const inputHeight = useComposerDragResize(inputRef, !isDraft);
	const plan = useApprovePlan();
	const refining = plan.canReply;

	const slash = useSlashCommands(context.directory);
	const runTypedClientCommand = useRunTypedClientSlashCommand(slash.commands);
	const sources = useMentionSources();
	// Past the hooks, so the compiler caches it on `slash.commands` and `sources`.
	const formatter = combineFormatters(
		kiloSlashFormatter(slash.commands),
		createMentionFormatter(sources),
		isMentionType,
	);
	const icons = mentionIcons(sources);
	const mentionContext = {
		workSessionId: context.workSessionId,
		directory: context.directory,
		workspaceId: context.workspaceId,
		workspaceFolders: context.workspaceFolders,
	};

	useEffect(() => {
		if (!isDraft) return;
		const active = document.activeElement;
		if (active && active !== document.body && !inputRef.current?.contains(active)) return;
		inputRef.current
			?.querySelector<HTMLElement>("[contenteditable]")
			?.focus({ preventScroll: true });
	}, [isDraft]);

	const handleInputKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (
			event.key === "Tab" &&
			event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.nativeEvent.isComposing &&
			!isCatalogError
		) {
			event.preventDefault();
			const next = cycleCatalogAgent(
				catalog ?? (isCatalogPending ? OPTIMISTIC_AGENT_CATALOG : undefined),
				agent,
				1,
			);
			if (next && next !== agent) setAgent(next);
			return;
		}
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		if (event.defaultPrevented && hasMessageQueue) return;
		// Queue only when a run was already in flight and Lexical skipped send.
		if (aui.thread.getState().isRunning && hasMessageQueue && !isComposerEmpty) {
			event.preventDefault();
			aui.composer.send();
		}
	};

	return (
		<MentionIconsContext.Provider value={icons}>
			<ComposerPrimitive.Unstable_TriggerPopoverRoot>
				<ComposerPrimitive.Root
					className="aui-composer-root relative flex w-full flex-col gap-2"
					onSubmit={(event: FormEvent<HTMLFormElement>) => {
						if (!refining) return;
						event.preventDefault();
						if (!isComposerEmpty) plan.refine();
					}}
				>
					<ComposerSubagentStrip />
					<ComposerTaskList />
					<ComposerQueue steerOnEnter={hasMessageQueue && isComposerEmpty} />
					<ComposerPrimitive.AttachmentDropzone
						render={
							<div
								data-slot="aui_composer-shell"
								className={cn(
									"border-border-subtle chat-composer-surface data-[dragging=true]:border-ring flex w-full flex-col gap-2 rounded-(--composer-radius) border px-(--composer-padding) pt-2 pb-(--composer-padding) transition-[border-color,outline-color,box-shadow] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]",
									"chat-composer-glass shadow-composer relative z-10",
								)}
							/>
						}
					>
						{inputHeight.canResize ? (
							<ComposerResizeHandle
								ratio={inputHeight.ratio}
								onResize={inputHeight.setRatio}
								measureDragStart={inputHeight.measureDragStart}
							/>
						) : null}
						<ComposerAttachments />
						<KiloLexicalComposerInput
							ref={inputRef}
							formatter={formatter}
							placeholder={composerPlaceholder(sources)}
							submitMode="enter"
							onKeyDown={handleInputKeyDown}
							style={inputHeight.inputStyle}
							onEnter={() => {
								if (runTypedClientCommand({ fromEnter: true })) return true;
								// The follow-up keeps the thread running: Enter refines instead of queueing.
								if (!refining) return false;
								if (!aui.composer.getState().isEmpty) plan.refine();
								return true;
							}}
						/>
						<KiloSlashTrigger slash={slash} formatter={formatter} />
						<MentionTriggers sources={sources} context={mentionContext} formatter={formatter} />
						<ComposerActionBar
							refining={refining}
							refinePending={plan.submitting}
							onRefine={() => plan.refine()}
							onSendClick={(event) => {
								if (runTypedClientCommand({ fromEnter: false })) event.preventDefault();
							}}
						/>
					</ComposerPrimitive.AttachmentDropzone>
				</ComposerPrimitive.Root>
			</ComposerPrimitive.Unstable_TriggerPopoverRoot>
		</MentionIconsContext.Provider>
	);
};

const ComposerActionBar: FC<{
	refining: boolean;
	refinePending: boolean;
	onRefine: () => void;
	/** Runs before Send or Queue sends; preventing the event keeps the draft from being sent. */
	onSendClick: (event: MouseEvent<HTMLButtonElement>) => void;
}> = ({ refining, refinePending, onRefine, onSendClick }) => {
	const aui = useAui();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);
	const canQueue = useAuiState((s) => s.thread.capabilities.queue);
	const { hasActiveSubagents, stopAllSubagents } = useSubagentActivity();
	const [stoppingAll, setStoppingAll] = useState(false);
	const busy = isRunning || hasActiveSubagents;
	const stopEverything = () => {
		if (stoppingAll) return;
		// Cancelling pauses the queue; stopping the chat's tree also stops
		// subagents the transcript doesn't see as running. A repeat abort is a no-op.
		if (isRunning) aui.thread().cancelRun();
		setStoppingAll(true);
		void stopAllSubagents().finally(() => setStoppingAll(false));
	};

	return (
		<div className="aui-composer-action-wrapper relative flex items-center justify-between gap-1.5">
			{/* Only the selectors absorb overflow; the action buttons keep their size. */}
			<div className="flex min-w-0 items-center gap-0" data-qa-id="kilo-composer-toolbar">
				<ComposerActionSlotView slot="toolbar" />
			</div>
			<div className="flex shrink-0 items-center gap-1.5" data-qa-id="kilo-composer-toolbar-end">
				<AuiIf condition={(s) => s.thread.capabilities.dictation}>
					<AuiIf condition={(s) => s.composer.dictation == null}>
						<ComposerPrimitive.Dictate
							render={
								<TooltipIconButton
									tooltip="Voice input"
									side="bottom"
									type="button"
									variant="ghost"
									size="icon"
									className="aui-composer-dictate size-7 rounded-full"
									aria-label="Start voice input"
								/>
							}
						>
							<MicIcon className="aui-composer-dictate-icon size-4" />
						</ComposerPrimitive.Dictate>
					</AuiIf>
					<AuiIf condition={(s) => s.composer.dictation != null}>
						<ComposerPrimitive.StopDictation
							render={
								<TooltipIconButton
									tooltip="Stop dictation"
									side="bottom"
									type="button"
									variant="ghost"
									size="icon"
									className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
									aria-label="Stop voice input"
								/>
							}
						>
							<SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
						</ComposerPrimitive.StopDictation>
					</AuiIf>
				</AuiIf>
				<ComposerActionSlotView slot="toolbar-end" />
				{refining ? (
					<Button
						type="button"
						size="sm"
						className="h-7 rounded-full px-3"
						disabled={isComposerEmpty || refinePending}
						data-qa-id="kilo-composer-refine"
						aria-label="Refine plan"
						onClick={onRefine}
					>
						{refinePending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						Refine
					</Button>
				) : null}
				{(!refining || hasActiveSubagents) && busy ? (
					<>
						{!refining && canQueue && !isComposerEmpty ? (
							<ComposerPrimitive.Send
								onClick={onSendClick}
								render={
									<Button
										type="button"
										variant="default"
										size="sm"
										className="h-7 rounded-full px-3"
										aria-label="Add message to queue"
										data-qa-id="kilo-composer-queue-submit"
									/>
								}
							>
								Queue
							</ComposerPrimitive.Send>
						) : null}
						{hasActiveSubagents ? (
							<TooltipIconButton
								tooltip="Stop generating"
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-cancel size-7 rounded-full"
								aria-label="Stop generating"
								data-qa-id="kilo-composer-stop"
								disabled={stoppingAll}
								onClick={stopEverything}
							>
								<SquareIcon className="size-3.5 fill-current" />
							</TooltipIconButton>
						) : (
							<ComposerPrimitive.Cancel
								render={
									<TooltipIconButton
										tooltip="Stop generating"
										type="button"
										variant={canQueue && !isComposerEmpty ? "outline" : "default"}
										size="icon"
										className="aui-composer-cancel size-7 rounded-full"
										aria-label="Stop generating"
										data-qa-id="kilo-composer-stop"
									/>
								}
							>
								<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
							</ComposerPrimitive.Cancel>
						)}
					</>
				) : null}
				{!refining && !busy ? (
					<ComposerPrimitive.Send
						onClick={onSendClick}
						render={
							<TooltipIconButton
								tooltip="Send message"
								side="bottom"
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-send bg-primary-brand text-primary-brand-foreground border-primary-brand-edge hover:bg-primary-brand/85 size-7 rounded-full"
								aria-label="Send message"
								data-qa-id="kilo-composer-send"
							/>
						}
					>
						<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
					</ComposerPrimitive.Send>
				) : null}
			</div>
		</div>
	);
};
