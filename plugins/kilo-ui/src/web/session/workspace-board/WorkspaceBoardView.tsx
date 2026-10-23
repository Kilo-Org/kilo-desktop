import type { FC, PointerEvent as ReactPointerEvent } from "react";

import { ScrollArea } from "@kilo-desktop/ui/components/scroll-area";

import type { Workspace } from "../../../contracts/workspaces/schemas.js";
import type { BoardColumnView, BoardSession } from "./workspace-board-sessions.js";
import { WorkspaceBoardCard, type WorkspaceBoardCardActions } from "./WorkspaceBoardCard.js";
import { headingId, WorkspaceBoardColumnHeader } from "./WorkspaceBoardColumnHeader.js";
import type { BoardDragItem } from "./workspace-board-drag-target.js";

type WorkspaceBoardViewProps = {
	columns: readonly BoardColumnView[];
	workspaces: readonly Workspace[];
	onDragStart: (event: ReactPointerEvent<HTMLElement>, item: BoardDragItem) => void;
	onOpen: (session: BoardSession) => void;
	/** Chat actions for each card; omitted where there is no chat runtime. */
	cardActions?: WorkspaceBoardCardActions | undefined;
	/** A just-added column whose header should start renaming it. */
	columnToName?: string | null | undefined;
	onColumnNamingStarted?: (() => void) | undefined;
	onRenameColumn: (columnId: string, label: string) => void;
	onMoveColumn: (columnId: string, index: number) => void;
	onDeleteColumn: (columnId: string) => void;
};

/**
 * The `data-workspace-board*` attributes are the drag controller's contract: it
 * finds columns, card lists and cards by geometry rather than through React.
 * Popping the board out also measures the column strip to size its window.
 *
 * Fixed-width columns sit on one row that scrolls sideways. As in Trello, each
 * column is only as tall as its cards until it reaches the board's height, then
 * scrolls them.
 */
export const WorkspaceBoardView: FC<WorkspaceBoardViewProps> = ({
	columns,
	workspaces,
	onDragStart,
	onOpen,
	cardActions,
	columnToName,
	onColumnNamingStarted,
	onRenameColumn,
	onMoveColumn,
	onDeleteColumn,
}) => (
	// The shell's page wrapper is a block, so the board takes its height explicitly.
	<div data-workspace-board data-qa-id="workspace-board" className="flex h-full min-h-0 flex-col">
		<div
			data-workspace-board-columns
			// A size container, so columns can cap their cards at the strip's height (cqh).
			// p-2: the shell's one 8px pane gutter, so switching from a chat does not shift content.
			className="@container-size flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-2"
		>
			{columns.map((column, index) => (
				<section
					key={column.id}
					data-workspace-board-column
					data-column-id={column.id}
					role="group"
					aria-labelledby={headingId(column.id)}
					data-qa-id={`workspace-board-column-${column.id}`}
					className="bg-foreground/3 data-[drop-active]:border-primary-ink data-[drop-active]:bg-primary/5 flex w-72 shrink-0 flex-col rounded-xl border border-transparent transition-colors data-[drop-active]:border-dashed"
				>
					<WorkspaceBoardColumnHeader
						column={column}
						index={index}
						columnCount={columns.length}
						onRename={onRenameColumn}
						onMove={onMoveColumn}
						onDelete={onDeleteColumn}
						onDragStart={onDragStart}
						startNaming={column.id === columnToName}
						onNamingStarted={onColumnNamingStarted}
					/>
					{/* ScrollArea's viewport only scrolls under a set height; the column has none, so
						    the viewport is capped at the strip's height less the header (h-10) and borders. */}
					<ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[calc(100cqh-(--spacing(10))-2px)]">
						{/* Top padding keeps the first card's outline inside the scroll viewport, which clips it. */}
						<ol data-workspace-board-cards className="flex flex-col gap-2 px-2 pt-1 pb-2">
							{column.cards.map((card) => (
								<WorkspaceBoardCard
									key={card.sessionId}
									session={card}
									workspaces={workspaces}
									actions={cardActions}
									onDragPointerDown={(event) =>
										onDragStart(event, {
											sessionId: card.sessionId,
											title: card.title,
											kind: "card",
										})
									}
									onOpen={onOpen}
								/>
							))}
							{column.cards.length === 0 ? (
								<li
									data-workspace-board-empty
									className="text-muted-foreground flex h-15 list-none items-center justify-center rounded-xl border border-dashed text-xs"
								>
									Drop sessions here
								</li>
							) : null}
						</ol>
					</ScrollArea>
				</section>
			))}
		</div>
	</div>
);
