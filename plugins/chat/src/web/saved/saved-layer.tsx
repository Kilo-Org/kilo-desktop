import { createContext, use, useEffect, useState, type FC, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";
import {
	SavedItems,
	type SavedItem,
	type SavedItemsState,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { SavedToast } from "@kilo-desktop/ui/components/reading/saved-toast";
import { SelectionMenu } from "@kilo-desktop/ui/components/reading/selection-menu";
import { rememberExcerpt } from "@kilo-desktop/ui/lib/reading/excerpts";
import { createSavedPainter } from "@kilo-desktop/ui/lib/reading/saved-highlights";
import {
	buildTextIndex,
	findQuote,
	locateQuote,
	quoteOf,
	rangeOf,
	type TextQuote,
} from "@kilo-desktop/ui/lib/reading/text-anchor";

import type { ChatSaved, SavedSurface } from "./chat-saved";
import { kindOf } from "./chat-saved";
import { CHAT_TEXT_SOURCE, parseTextAnchor, replySurfaces } from "./saved-anchor";

const NO_ITEMS: readonly SavedItem[] = [];
const selectItems = (state: SavedItemsState) => state.items;
const MESSAGE = "[data-message-id]";

/** The saved items of one chat, live. */
export function useChatSavedItems(chatId: string | null): readonly SavedItem[] {
	const items = useDomainObjectState(SavedItems, selectItems) ?? NO_ITEMS;
	return chatId ? items.filter((item) => item.ref.id === chatId) : NO_ITEMS;
}

interface ToastState {
	readonly id: number;
	readonly message: string;
	readonly onUndo?: () => void;
	readonly onView?: () => void;
}

interface SavedLayerValue {
	readonly saved: ChatSaved;
	readonly workSessionId: string;
	readonly chatId: string;
	readonly showToast: (toast: Omit<ToastState, "id">) => void;
}

const SavedLayerContext = createContext<SavedLayerValue | null>(null);

/** What the bookmark button needs: the window's Saved and this pane's chat. */
export function useSavedLayer(): SavedLayerValue | null {
	return use(SavedLayerContext);
}

/**
 * Saved in a reply view (the transcript, or the reply in Focus): paints the
 * chat's saved text where it is shown, offers Save (or Remove over saved
 * text) and Copy next to a selection in reply text, and confirms with a
 * toast offering View and Undo. `root` is the element holding the replies;
 * the toast portals into `toastSlot`, the host's (the pane's bottom centre,
 * or the Focus reader's), which hides what it replaces while it is filled.
 */
export const SavedLayer: FC<{
	saved: ChatSaved | undefined;
	workSessionId: string;
	chatId: string | null;
	root: HTMLElement | null;
	surface: SavedSurface;
	/** Where the toast is shown; under the replies when left out. */
	toastSlot?: HTMLElement | null;
	canView: boolean;
	children?: ReactNode;
}> = ({ saved, workSessionId, chatId, root, surface, toastSlot, canView, children }) => {
	const kernel = useKernel();
	const items = useChatSavedItems(chatId);
	const [toast, setToast] = useState<ToastState | null>(null);
	// Each toast gets a new id, so its countdown and Undo belong to it alone.
	const showToast = (next: Omit<ToastState, "id">) =>
		setToast((current) => ({ ...next, id: (current?.id ?? 0) + 1 }));
	const value = saved && chatId ? { saved, workSessionId, chatId, showToast } : null;

	useSavedPainter(root, items);
	const { selection, showRemove } = useReplySelection(root, items);

	const close = (id: number) => setToast((current) => (current?.id === id ? null : current));
	const toastNode = toast ? (
		<SavedToast
			key={toast.id}
			message={toast.message}
			onClose={() => close(toast.id)}
			{...(toast.onUndo ? { onUndo: toast.onUndo } : {})}
			{...(toast.onView && canView ? { onView: toast.onView } : {})}
			qaId="chat-saved-toast"
		/>
	) : null;

	const save = async () => {
		if (!value || !selection || selection.mode !== "save") return;
		const { messageId, quote, rect } = selection;
		clearSelection();
		const added = await value.saved.saveText(
			{ workSessionId, chatId: value.chatId },
			messageId,
			quote,
			surface,
		);
		value.saved.reading.track("selection-menu-used", { action: "save", surface });
		if (added === "too-long" || !added) {
			selection.dismiss();
			showToast({
				message:
					added === "too-long"
						? "Too long to save. Select a shorter passage."
						: "Couldn't save this text",
			});
			return;
		}
		const { item } = added;
		showRemove(item, rect);
		// It was saved before: no Undo, which would take out the earlier save.
		if (!added.created) {
			showToast({ message: "Already in Saved", onView: viewSaved });
			return;
		}
		showToast({
			message: "Added to Saved",
			onView: viewSaved,
			onUndo: () => {
				value.saved.reading.track("saved-toast-action", { action: "undo", kind: "text" });
				void undoSave(item);
			},
		});
	};

	const viewSaved = () => {
		if (!value) return;
		value.saved.reading.track("saved-toast-action", { action: "view", kind: "text" });
		void value.saved.viewSaved((command, args) => kernel.commands.execute(command, args));
	};

	const undoSave = async (item: SavedItem) => {
		if ((await value?.saved.remove(item, "undo")) === "failed") {
			showToast({ message: "Couldn't remove this from Saved" });
		}
	};

	const remove = async () => {
		if (!value || !selection || selection.mode !== "remove") return;
		const item = selection.item;
		clearSelection();
		value.saved.reading.track("selection-menu-used", { action: "remove", surface });
		const removed = await value.saved.remove(item, "highlight-menu");
		if (removed === "failed") {
			showToast({ message: "Couldn't remove this from Saved" });
			return;
		}
		if (!removed) return;
		showToast({
			message: "Removed from Saved",
			onUndo: () => {
				value.saved.reading.track("saved-toast-action", { action: "undo", kind: kindOf(item) });
				void value.saved.restore(removed).then((restored) => {
					if (!restored) showToast({ message: "Couldn't put this back in Saved" });
				});
			},
		});
	};

	const copy = async () => {
		if (!selection) return;
		const text = selection.mode === "save" ? selection.quote.exact : selection.item.text;
		clearSelection();
		await navigator.clipboard?.writeText(text).catch(() => undefined);
		if (surface === "focus") rememberExcerpt(text, "reply");
		saved?.reading.track("selection-menu-used", { action: "copy", surface });
	};

	return (
		<SavedLayerContext value={value}>
			{children}
			{selection && value ? (
				<SelectionMenu
					// Save and Remove differ in width: a new menu re-centres for the new mode.
					key={selection.mode}
					anchor={selection.rect}
					mode={selection.mode}
					onSave={() => void save()}
					onRemove={() => void remove()}
					onCopy={() => void copy()}
					onDismiss={() => {
						selection.dismiss();
					}}
					qaId="chat-selection-menu"
				/>
			) : null}
			{toastSlot === undefined ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
					{toastNode}
				</div>
			) : toastSlot && toastNode ? (
				createPortal(toastNode, toastSlot)
			) : null}
		</SavedLayerContext>
	);
};

function clearSelection(): void {
	globalThis.getSelection?.()?.removeAllRanges();
}

/** Paints the chat's saved text wherever its replies are shown under `root`, again after every re-render. */
/** The least time between two repaints while a reply keeps streaming. */
const REPAINT_INTERVAL_MS = 150;

/**
 * Paints the chat's saved passages. Each message is indexed once for all its
 * anchors, and after a change only the messages that changed are located
 * again (a streaming reply touches one); repaints are spaced out while text
 * keeps arriving.
 */
function useSavedPainter(root: HTMLElement | null, items: readonly SavedItem[]): void {
	useEffect(() => {
		if (!root) return;
		const painter = createSavedPainter();
		const byMessage = new Map<string, TextQuote[]>();
		for (const item of items) {
			if (item.source !== CHAT_TEXT_SOURCE) continue;
			const anchor = parseTextAnchor(item.anchor);
			if (!anchor) continue;
			byMessage.set(anchor.messageId, [
				...(byMessage.get(anchor.messageId) ?? []),
				anchor.selector,
			]);
		}
		const located = new Map<string, Range[]>();
		const locate = (messageId: string, quotes: readonly TextQuote[]) => {
			const message = root.querySelector(`${MESSAGE}[data-message-id="${CSS.escape(messageId)}"]`);
			const surfaces = message ? replySurfaces(message) : [];
			if (surfaces.length === 0) return void located.delete(messageId);
			const index = buildTextIndex(surfaces);
			const ranges = quotes.flatMap((quote) => {
				const found = findQuote(index.text, quote);
				const range = found ? rangeOf(index, found.start, found.end) : null;
				return range ? [range] : [];
			});
			located.set(messageId, ranges);
		};
		const paint = () => painter.paint([...located.values()].flat());
		for (const [messageId, quotes] of byMessage) locate(messageId, quotes);
		paint();
		if (byMessage.size === 0) return () => painter.dispose();

		// Messages changed since the last repaint; null means "can't tell, all of them".
		let changed: Set<string> | null = new Set();
		let frame = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let lastPaint = performance.now();
		const repaint = () => {
			frame = 0;
			timer = undefined;
			lastPaint = performance.now();
			const ids = changed ?? new Set(byMessage.keys());
			changed = new Set();
			for (const messageId of ids) {
				const quotes = byMessage.get(messageId);
				if (quotes) locate(messageId, quotes);
			}
			paint();
		};
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				const target =
					record.target instanceof Element ? record.target : record.target.parentElement;
				const messageId = target?.closest<HTMLElement>(MESSAGE)?.dataset.messageId;
				// A change above the messages (one added or removed) may move any of them.
				if (!messageId) changed = null;
				else changed?.add(messageId);
			}
			if (frame || timer) return;
			const wait = REPAINT_INTERVAL_MS - (performance.now() - lastPaint);
			if (wait <= 0) frame = requestAnimationFrame(repaint);
			else timer = setTimeout(() => (frame = requestAnimationFrame(repaint)), wait);
		});
		observer.observe(root, { childList: true, subtree: true, characterData: true });
		return () => {
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
			if (timer) clearTimeout(timer);
			painter.dispose();
		};
	}, [items, root]);
}

type Selection =
	| {
			readonly mode: "save";
			readonly rect: DOMRect;
			readonly messageId: string;
			readonly quote: NonNullable<ReturnType<typeof quoteOf>>;
			readonly dismiss: () => void;
	  }
	| {
			readonly mode: "remove";
			readonly rect: DOMRect;
			readonly item: SavedItem;
			readonly dismiss: () => void;
	  };

/**
 * The settled selection inside one reply's text under `root`, as Save; a
 * click (collapsed selection) inside saved text, as Remove. Recomputed when
 * the pointer or keyboard releases, never mid-drag. Text just saved is shown
 * as Remove in place (`showRemove`), until it leaves Saved (Undo) or the
 * menu is dismissed.
 */
/**
 * The part of `range` inside the reply's text. A triple-click selects a
 * paragraph by running the range to the start of whatever follows it (the
 * action row, the next message), so an end outside the text is pulled back to
 * the end of the last surface it covers, and a start outside to the start of
 * the first. Null when the range touches no surface or starts and ends outside.
 */
function trimToSurfaces(range: Range, surfaces: readonly HTMLElement[]): Range | null {
	const inside = (node: Node) => surfaces.some((surface) => surface.contains(node));
	const startInside = inside(range.startContainer);
	const endInside = inside(range.endContainer);
	if (startInside && endInside) return range;
	if (!startInside && !endInside) return null;
	const covered = surfaces.filter((surface) => range.intersectsNode(surface));
	const first = covered[0];
	const last = covered.at(-1);
	if (!first || !last) return null;
	const trimmed = range.cloneRange();
	if (!startInside) trimmed.setStart(first, 0);
	if (!endInside) trimmed.setEnd(last, last.childNodes.length);
	return trimmed.collapsed ? null : trimmed;
}

function useReplySelection(
	root: HTMLElement | null,
	items: readonly SavedItem[],
): {
	selection: Selection | null;
	showRemove: (item: SavedItem, rect: DOMRect) => void;
} {
	const [selection, setSelection] = useState<Selection | null>(null);
	const latestItems = useLatestRef(items);
	const showRemove = (item: SavedItem, rect: DOMRect) =>
		setSelection({ mode: "remove", rect, item, dismiss: () => setSelection(null) });
	const shown =
		selection?.mode === "remove" && !items.some((item) => item.id === selection.item.id)
			? null
			: selection;

	useEffect(() => {
		if (!root) return;
		const dismiss = () => setSelection(null);
		const read = (event?: Event) => {
			const current = globalThis.getSelection?.();
			if (!current || current.rangeCount === 0) return setSelection(null);
			const range = current.getRangeAt(0);
			const startElement =
				range.startContainer instanceof Element
					? range.startContainer
					: range.startContainer.parentElement;
			const message = startElement?.closest<HTMLElement>(MESSAGE);
			if (!message || !root.contains(message)) return setSelection(null);
			const surfaces = replySurfaces(message);
			const messageId = message.dataset.messageId!;
			if (current.isCollapsed) {
				if (event?.type !== "pointerup") return setSelection(null);
				const item = savedAt(surfaces, messageId, range, latestItems.current);
				if (!item) return setSelection(null);
				const box = rangeBoxOf(surfaces, item);
				return setSelection(box ? { mode: "remove", rect: box, item, dismiss } : null);
			}
			const trimmed = trimToSurfaces(range, surfaces);
			if (!trimmed) return setSelection(null);
			const quote = quoteOf(surfaces, trimmed);
			if (!quote) return setSelection(null);
			setSelection({
				mode: "save",
				rect: trimmed.getBoundingClientRect(),
				messageId,
				quote,
				dismiss,
			});
		};
		const onUp = (event: Event) => requestAnimationFrame(() => read(event));
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.shiftKey || event.key.startsWith("Arrow")) read(event);
		};
		// The replies scroll inside an ancestor (the transcript viewport, the
		// Focus scroller), and scroll events don't bubble: listen at the document
		// and close the menu when what scrolled moves the replies.
		const onScroll = (event: Event) => {
			const scrolled = event.target;
			if (
				scrolled === document ||
				(scrolled instanceof Node && (scrolled.contains(root) || root.contains(scrolled)))
			)
				setSelection(null);
		};
		root.addEventListener("pointerup", onUp);
		root.addEventListener("keyup", onKeyUp);
		document.addEventListener("scroll", onScroll, { capture: true, passive: true });
		return () => {
			root.removeEventListener("pointerup", onUp);
			root.removeEventListener("keyup", onKeyUp);
			document.removeEventListener("scroll", onScroll, { capture: true });
		};
	}, [latestItems, root]);
	return { selection: shown, showRemove };
}

/** The saved text item under a caret position in a reply, if any. */
function savedAt(
	surfaces: readonly HTMLElement[],
	messageId: string,
	caret: Range,
	items: readonly SavedItem[],
): SavedItem | null {
	for (const item of items) {
		if (item.source !== CHAT_TEXT_SOURCE) continue;
		const anchor = parseTextAnchor(item.anchor);
		if (!anchor || anchor.messageId !== messageId) continue;
		const range = locateQuote(surfaces, anchor.selector);
		if (range && range.comparePoint(caret.startContainer, caret.startOffset) === 0) return item;
	}
	return null;
}

function rangeBoxOf(surfaces: readonly HTMLElement[], item: SavedItem): DOMRect | null {
	const anchor = parseTextAnchor(item.anchor);
	return anchor ? (locateQuote(surfaces, anchor.selector)?.getBoundingClientRect() ?? null) : null;
}
