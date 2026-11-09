import { MessageSquareIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useDomain,
	useDragSource,
	useExclusive,
} from "@kilo-desktop/kernel/web";
import {
	SessionRenderer,
	Sessions,
	type Session,
	type SessionRenderers,
} from "@kilo-desktop/plugin-sessions/contracts";
import type { Workspace } from "@kilo-desktop/plugin-workspaces/contracts";
import { Card, CardDescription, CardHeader, CardTitle } from "@kilo-desktop/ui/components/card";
import { Input } from "@kilo-desktop/ui/components/input";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { workspaceGlyphColor } from "@kilo-desktop/ui/components/workspace-picker";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { RelativeTime } from "./relative-time";

type RendererContribution = Contribution<typeof SessionRenderer>;

/** One of the session renderers, rendered in the providing plugin's context. */
function Rendered<TProps extends object>({
	renderer,
	pick,
	props,
}: {
	readonly renderer: RendererContribution;
	readonly pick: (renderers: SessionRenderers) => ComponentType<TProps>;
	readonly props: TProps;
}) {
	return <RenderContribution contribution={renderer} select={pick as never} props={props} />;
}

const pickGlyph = (renderers: SessionRenderers) => renderers.Glyph;
const pickStatus = (renderers: SessionRenderers) => renderers.Status;
const pickDecorations = (renderers: SessionRenderers) => renderers.Decorations;
const pickMenu = (renderers: SessionRenderers) => renderers.Menu;

const cardActionsClassName = cn(
	"pointer-events-auto flex -ml-2 w-0 overflow-hidden opacity-0 transition-opacity motion-reduce:transition-none",
	"group-hover/card:ml-0 group-hover/card:-mr-1 group-hover/card:w-auto group-hover/card:overflow-visible group-hover/card:opacity-100",
	"has-[:focus-visible]:ml-0 has-[:focus-visible]:-mr-1 has-[:focus-visible]:w-auto has-[:focus-visible]:overflow-visible has-[:focus-visible]:opacity-100",
	"has-[[data-popup-open]]:ml-0 has-[[data-popup-open]]:-mr-1 has-[[data-popup-open]]:w-auto has-[[data-popup-open]]:overflow-visible has-[[data-popup-open]]:opacity-100",
);

/**
 * A session on the board, shown the way the session list shows it through
 * kilo.sessions' renderers: its live glyph and status, plugins' row
 * decorations (git's PR badge, interactive here since it sits outside the
 * open button) and the session menu. The whole card opens
 * the session through a stretched button beneath the content, whose layers
 * are pointer-transparent except for their own controls. The card drags the
 * session as an object reference.
 */
export function BoardCard({
	session,
	workspaces,
	onOpen,
}: {
	readonly session: Session;
	readonly workspaces: readonly Workspace[];
	readonly onOpen: (sessionId: string) => void;
}) {
	const renderer = useExclusive(SessionRenderer).winner;
	const [renaming, setRenaming] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const drag = useDragSource([{ type: Sessions.id, id: session.id }], { disabled: renaming });
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
							{renderer ? (
								<Rendered
									renderer={renderer}
									pick={pickGlyph}
									props={{ session, decorative: true }}
								/>
							) : null}
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
						{renderer && !renaming ? (
							<span className={cardActionsClassName}>
								<Rendered
									renderer={renderer}
									pick={pickMenu}
									props={{
										session,
										onRename: () => setRenaming(true),
										triggerRef,
										side: "bottom" as const,
										label: `Session actions for ${session.title}`,
									}}
								/>
							</span>
						) : null}
					</CardTitle>
					<CardDescription className="flex h-4 w-full min-w-0 items-center gap-2 text-xs">
						<span className="flex min-w-0">
							{renderer ? (
								<Rendered renderer={renderer} pick={pickStatus} props={{ session }} />
							) : null}
						</span>
						<span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
							{renderer ? (
								<span className="pointer-events-auto flex items-center gap-1 empty:hidden">
									<Rendered
										renderer={renderer}
										pick={pickDecorations}
										props={{ session, slot: "row" as const, interactive: true }}
									/>
								</span>
							) : null}
							<RelativeTime timestamp={session.updatedAt} />
						</span>
					</CardDescription>
				</CardHeader>
			</Card>
		</li>
	);
}

/** Inline rename through `Sessions.rename`: Enter or leaving saves a changed title, Escape cancels. */
function CardRenameInput({
	session,
	onDone,
}: {
	readonly session: Session;
	readonly onDone: () => void;
}) {
	const sessions = useDomain(Sessions);
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
