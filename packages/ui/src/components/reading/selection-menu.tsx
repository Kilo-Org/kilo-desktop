import { BookmarkMinusIcon, BookmarkPlusIcon, CopyIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FC } from "react";
import { createPortal } from "react-dom";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useFocusLayer, useFocusPortalContainer } from "./focus-context";

export interface SelectionMenuProps {
	/** The selection's box in the viewport. */
	readonly anchor: DOMRect;
	/** "save" for new text; "remove" over text already saved. */
	readonly mode: "save" | "remove";
	readonly onSave: () => void;
	readonly onRemove: () => void;
	readonly onCopy: () => void;
	readonly onDismiss: () => void;
	readonly qaId?: string;
}

const GAP = 8;

/**
 * The small menu next to selected text: Save (or Remove over saved text),
 * a divider and Copy. 34px high with a 9px radius, above the selection (below
 * it near the top of the window). Escape and a press elsewhere dismiss it.
 * Inside the Focus reader it portals into the reader to take its theme.
 */
export const SelectionMenu: FC<SelectionMenuProps> = ({
	anchor,
	mode,
	onSave,
	onRemove,
	onCopy,
	onDismiss,
	qaId = "selection-menu",
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const container = useFocusPortalContainer();
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	useFocusLayer(true);
	const latest = useLatestRef(onDismiss);

	useLayoutEffect(() => {
		const menu = ref.current;
		if (!menu) return;
		const { width, height } = menu.getBoundingClientRect();
		const above = anchor.top - height - GAP;
		const top = above >= 8 ? above : anchor.bottom + GAP;
		const left = Math.min(
			Math.max(8, anchor.left + anchor.width / 2 - width / 2),
			window.innerWidth - width - 8,
		);
		setPosition({ top, left });
	}, [anchor]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			latest.current();
		};
		const onDown = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) latest.current();
		};
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("pointerdown", onDown, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("pointerdown", onDown, true);
		};
	}, [latest]);

	const button =
		"text-foreground hover:bg-state-hover flex h-[26px] items-center gap-1.5 rounded-[6px] px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
	return createPortal(
		<div
			ref={ref}
			role="toolbar"
			aria-label="Selection"
			data-qa-id={qaId}
			className={cn(
				"bg-popover text-popover-foreground border-border-subtle fixed z-50 flex h-[34px] items-center gap-1 rounded-[9px] border px-1 shadow-lg",
				position ? "visible" : "invisible",
			)}
			style={position ?? { top: 0, left: 0 }}
			onPointerDown={(event) => event.preventDefault()}
		>
			{mode === "save" ? (
				<button type="button" className={button} onClick={onSave} data-qa-id={`${qaId}-save`}>
					<BookmarkPlusIcon aria-hidden="true" className="size-3.5" />
					Save
				</button>
			) : (
				<button type="button" className={button} onClick={onRemove} data-qa-id={`${qaId}-remove`}>
					<BookmarkMinusIcon aria-hidden="true" className="size-3.5" />
					Remove
				</button>
			)}
			<span aria-hidden="true" className="bg-border h-4 w-px" />
			<button
				type="button"
				aria-label="Copy"
				className={cn(button, "w-[26px] justify-center px-0")}
				onClick={onCopy}
				data-qa-id={`${qaId}-copy`}
			>
				<CopyIcon aria-hidden="true" className="size-3.5" />
			</button>
		</div>,
		container ?? document.body,
	);
};
