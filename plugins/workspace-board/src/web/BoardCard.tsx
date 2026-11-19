import { MessageSquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useDomainObject, dragSourceProps } from "@kilo-desktop/kernel/web";
import {
	WorkSessionObjectType,
	WorkSessions,
	type WorkSession,
	type WorkSessionRenderers,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { Card, CardDescription, CardHeader, CardTitle } from "@kilo-desktop/ui/components/card";
import { Input } from "@kilo-desktop/ui/components/input";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { workspaceGlyphColor } from "@kilo-desktop/ui/components/workspace-picker";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { RelativeTime } from "./relative-time";

const cardActionsClassName = cn(
	"pointer-events-auto flex -ml-2 w-0 overflow-hidden opacity-0 transition-opacity motion-reduce:transition-none",
	"group-hover/card:ml-0 group-hover/card:-mr-1 group-hover/card:w-auto group-hover/card:overflow-visible group-hover/card:opacity-100",
	"has-[:focus-visible]:ml-0 has-[:focus-visible]:-mr-1 has-[:focus-visible]:w-auto has-[:focus-visible]:overflow-visible has-[:focus-visible]:opacity-100",
	"has-[[data-popup-open]]:ml-0 has-[[data-popup-open]]:-mr-1 has-[[data-popup-open]]:w-auto has-[[data-popup-open]]:overflow-visible has-[[data-popup-open]]:opacity-100",
);

/**
 * A session on the board, shown the way the session list shows it through
 * the renderers kilo.work-sessions hands its work sessions views: its live glyph and status, plugins' row
 * decorations (git's PR badge, interactive here since it sits outside the
 * open button) and the session menu. The whole card opens
 * the session through a stretched button beneath the content, whose layers
 * are pointer-transparent except for their own controls. The card drags the
 * session as an object reference (`kilo.work-sessions/work-session`).
 */
export function BoardCard({
	session,
	workspaces,
	renderers: { Glyph, Status, Decorations, Menu },
	onOpen,
}: {
	readonly session: WorkSession;
	readonly workspaces: readonly Workspace[];
	readonly renderers: WorkSessionRenderers;
	readonly onOpen: (sessionId: string) => void;
}) {
	const [renaming, setRenaming] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const drag = dragSourceProps([{ type: WorkSessionObjectType.id, id: session.id }], {
		disabled: renaming,
	});
	const workspace = workspaces.find((candidate) => candidate.id === session.workspaceId);
	const workspaceColor = workspaceGlyphColor(workspace?.color);
	const locationLabel = workspace?.name ?? null;

	return (
		<li
			{...drag}
			data-board-card
			data-session-id={session.id}
			data-qa-id={`workspace-board-card-${session.id}`}
			className="group/card list-none"
		>
			<Card size="sm" className="hover:ring-foreground/20 relative gap-1 py-2.5 transition-shadow">
				<button
					type="button"
					data-qa-id="workspace-board-card-open"
					aria-label={
						locationLabel ? `Open ${session.title} in ${locationLabel}` : `Open ${session.title}`
					}
					title={locationLabel ? `${session.title}\n${locationLabel}` : session.title}
					className="focus-visible:ring-ring/50 absolute inset-0 cursor-pointer rounded-[inherit] outline-none focus-visible:ring-3 focus-visible:ring-inset"
					onClick={() => onOpen(session.id)}
				/>
				<CardHeader className="pointer-events-none relative flex flex-col gap-1">
					<CardTitle className="flex h-5 w-full min-w-0 items-center gap-2 font-normal">
						<span className="peer flex shrink-0 empty:hidden">
							<Glyph workSession={session} decorative />
						</span>
						{/* The icon carries the workspace colour while the session has no live state. */}
						<MessageSquareIcon
							aria-hidden
							className="text-muted-foreground size-3.5 shrink-0 peer-[:not(:empty)]:hidden"
							{...(workspaceColor ? { color: workspaceColor } : {})}
						/>
						{renaming ? (
							<span className="pointer-events-auto flex min-w-0 flex-1">
								<CardRenameInput
									session={session}
									onDone={() => {
										setRenaming(false);
										triggerRef.current?.focus();
									}}
								/>
							</span>
						) : (
							<span
								data-qa-id="workspace-board-card-title"
								className={cn(
									"min-w-0 flex-1 truncate",
									session.archived && "text-muted-foreground",
								)}
							>
								{session.title}
							</span>
						)}
						{renaming ? null : (
							<span className={cardActionsClassName}>
								<Menu
									workSession={session}
									onRename={() => setRenaming(true)}
									triggerRef={triggerRef}
									side="bottom"
									label={`Session actions for ${session.title}`}
								/>
							</span>
						)}
					</CardTitle>
					<CardDescription className="flex h-4 w-full min-w-0 items-center gap-2 text-xs">
						<span className="flex min-w-0">
							<Status workSession={session} />
						</span>
						<span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
							<span className="pointer-events-auto flex items-center gap-1 empty:hidden">
								<Decorations workSession={session} slot="row" interactive />
							</span>
							<RelativeTime timestamp={session.updatedAt} />
						</span>
					</CardDescription>
				</CardHeader>
			</Card>
		</li>
	);
}

/** Inline rename through `WorkSessions.rename`: Enter or leaving saves a changed title, Escape cancels. */
function CardRenameInput({
	session,
	onDone,
}: {
	readonly session: WorkSession;
	readonly onDone: () => void;
}) {
	const sessions = useDomainObject(WorkSessions);
	const [value, setValue] = useState(session.title);
	const inputRef = useRef<HTMLInputElement>(null);
	const settledRef = useRef(false);
	useEffect(() => {
		inputRef.current?.select();
	}, []);
	const settle = (save: boolean) => {
		if (settledRef.current) return;
		settledRef.current = true;
		const title = value.trim();
		if (!save || !title || title === session.title || !sessions) {
			onDone();
			return;
		}
		sessions.methods.rename({ id: session.id, title }).then(onDone, (error: unknown) => {
			settledRef.current = false;
			toast.error("Could not rename session", {
				description: error instanceof Error ? error.message : "The session was not renamed.",
			});
		});
	};
	return (
		<Input
			ref={inputRef}
			autoFocus
			data-qa-id="workspace-board-card-rename"
			aria-label="Rename session"
			value={value}
			className="h-7 min-w-0 flex-1 px-1 text-sm"
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => settle(true)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					settle(true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					settle(false);
				}
			}}
		/>
	);
}
