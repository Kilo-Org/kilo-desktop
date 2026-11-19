import type { ReactNode } from "react";

import { Kbd, KbdGroup } from "@kilo-desktop/ui/components/kbd";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import type { CanvasPaneKind } from "../shared/pane-kinds";
import { useCommandShortcut } from "../shared/use-command-shortcut";

/**
 * The tool's open shortcut as flat keycaps of one width, shown while the tile
 * is hovered or focused; nothing when it has none, or the tile is too narrow
 * to keep its title whole. The tile's width is fixed by its grid, so the keys
 * fade in without moving anything.
 */
function ShortcutKeys({ commandId }: { readonly commandId: string | undefined }) {
	const keys = useCommandShortcut(commandId);
	if (keys.length === 0) return null;
	return (
		<KbdGroup
			data-qa-id="launcher-pane-shortcut"
			className="ms-auto hidden shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none @min-[10rem]:inline-flex"
		>
			{keys.map((key, index) => (
				// Display-only keycaps of one chord: never reordered, and a glyph may repeat.
				// react-doctor-disable-next-line react-doctor/no-array-index-as-key
				<Kbd
					key={index}
					className="bg-foreground/[0.07] size-5 rounded-[5px] px-0 text-[11px] font-normal"
				>
					{key}
				</Kbd>
			))}
		</KbdGroup>
	);
}

/** One tool: its icon, title and open shortcut (which also starts it from this page); what it does is the tooltip. */
function ToolTile({
	kind,
	disabled,
	starting,
	onStart,
}: {
	readonly kind: CanvasPaneKind;
	readonly disabled: boolean;
	/** The session is starting with this tool. */
	readonly starting: boolean;
	readonly onStart: (kind: CanvasPaneKind) => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled || Boolean(kind.unavailableHint)}
			className="group bg-foreground/6 hover:bg-foreground/9 focus-visible:ring-ring/50 disabled:hover:bg-foreground/6 @container flex h-11 min-w-0 items-center gap-1.5 rounded-[10px] ps-3 pe-2 text-start text-[13px] transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
			data-qa-id={`launcher-pane-${kind.id}`}
			title={kind.unavailableHint ?? kind.description}
			onClick={() => onStart(kind)}
		>
			{starting ? (
				<Spinner aria-hidden className="size-3.5 shrink-0" />
			) : (
				<kind.Icon className="size-3.5 shrink-0" />
			)}
			<span className="whitespace-nowrap">{kind.title}</span>
			<ShortcutKeys commandId={kind.openCommand} />
		</button>
	);
}

/**
 * How a session starts: the session starter (the composer), then a tile per
 * pane kind it can start with instead. An empty session starts from the New
 * empty session command.
 */
export function StartWithTool({
	starter,
	kinds,
	disabled,
	startingKind,
	onStart,
}: {
	readonly starter: ReactNode;
	readonly kinds: readonly CanvasPaneKind[];
	readonly disabled: boolean;
	/** The tool a session is starting with, if any. */
	readonly startingKind: string | null;
	readonly onStart: (kind: CanvasPaneKind) => void;
}) {
	return (
		<div data-qa-id="launcher-start-options" className="flex w-full flex-col items-center gap-3">
			{starter}
			{kinds.length > 0 ? (
				<div className="grid w-full grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
					{kinds.map((kind) => (
						<ToolTile
							key={kind.id}
							kind={kind}
							disabled={disabled}
							starting={kind.id === startingKind}
							onStart={onStart}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}
