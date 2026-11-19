import {
	createContext,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FC,
	type ReactNode,
} from "react";

import { useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";
import {
	SavedItems,
	type SavedItem,
	type SavedItemsState,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { SavedToast } from "@kilo-desktop/ui/components/reading/saved-toast";
import { SelectionMenu } from "@kilo-desktop/ui/components/reading/selection-menu";
import { rememberExcerpt } from "@kilo-desktop/ui/lib/reading/excerpts";
import { createSavedPainter } from "@kilo-desktop/ui/lib/reading/saved-highlights";
import { locateQuote, quoteOf } from "@kilo-desktop/ui/lib/reading/text-anchor";

import type { ChatSaved, SavedSurface } from "./chat-saved";
import { kindOf } from "./chat-saved";
import { CHAT_TEXT_SOURCE, parseTextAnchor, replySurfaces } from "./saved-anchor";

const NO_ITEMS: readonly SavedItem[] = [];
const selectItems = (state: SavedItemsState) => state.items;
const MESSAGE = "[data-message-id]";

/** The saved items of one chat, live. */
export function useChatSavedItems(chatId: string | null): readonly SavedItem[] {
	const items = useDomainObjectState(SavedItems, selectItems) ?? NO_ITEMS;
	return useMemo(
		() => (chatId ? items.filter((item) => item.ref.id === chatId) : NO_ITEMS),
		[chatId, items],
	);
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
 * `toastSlot` renders the toast where it belongs (the pane's bottom centre,
 * or the Focus reader's).
 */
export const SavedLayer: FC<{
	saved: ChatSaved | undefined;
	workSessionId: string;
	chatId: string | null;
	root: HTMLElement | null;
	surface: SavedSurface;
	/** Where the toast is shown; the pane's own slot when left out. */
	renderToast?: (toast: ReactNode | null) => void;
	canView: boolean;
	children?: ReactNode;
}> = ({ saved, workSessionId, chatId, root, surface, renderToast, canView, children }) => {
	const kernel = useKernel();
	const items = useChatSavedItems(chatId);
	const [toast, setToast] = useState<ToastState | null>(null);
	const nextToast = useRef(1);
	const showToast = useCallback(
		(next: Omit<ToastState, "id">) => setToast({ ...next, id: nextToast.current++ }),
		[],
	);
	const value = useMemo(
		() => (saved && chatId ? { saved, workSessionId, chatId, showToast } : null),
		[chatId, saved, showToast, workSessionId],
	);

	useSavedPainter(root, items);
	const { selection, showRemove } = useReplySelection(root, items);

	const close = useCallback(
		(id: number) => setToast((current) => (current?.id === id ? null : current)),
		[],
	);
	const toastNode = useMemo(
		() =>
			toast ? (
				<SavedToast
					key={toast.id}
					message={toast.message}
					onClose={() => close(toast.id)}
					{...(toast.onUndo ? { onUndo: toast.onUndo } : {})}
					{...(toast.onView && canView ? { onView: toast.onView } : {})}
					qaId="chat-saved-toast"
				/>
			) : null,
		[canView, close, toast],
	);
	useEffect(() => {
		renderToast?.(toastNode);
	}, [renderToast, toastNode]);
	useEffect(() => () => renderToast?.(null), [renderToast]);

	const save = async () => {
		if (!value || !selection || selection.mode !== "save") return;
		const { messageId, quote, rect } = selection;
		clearSelection();
		const item = await value.saved.saveText(
			{ workSessionId, chatId: value.chatId },
			messageId,
			quote,
			surface,
		);
		value.saved.reading.track("selection-menu-used", { action: "save", surface });
		if (!item) return selection.dismiss();
		showRemove(item, rect);
		showToast({
			message: "Added to Saved",
			onView: () => {
				value.saved.reading.track("saved-toast-action", { action: "view", kind: "text" });
				void value.saved.viewSaved((command, args) => kernel.commands.execute(command, args));
			},
			onUndo: () => {
				value.saved.reading.track("saved-toast-action", { action: "undo", kind: "text" });
				void value.saved.remove(item, "undo");
			},
		});
	};

	const remove = async () => {
		if (!value || !selection || selection.mode !== "remove") return;
		const item = selection.item;
		clearSelection();
		value.saved.reading.track("selection-menu-used", { action: "remove", surface });
		const removed = await value.saved.remove(item, "highlight-menu");
		if (!removed) return;
		showToast({
			message: "Removed from Saved",
			onUndo: () => {
				value.saved.reading.track("saved-toast-action", { action: "undo", kind: kindOf(item) });
				void value.saved.restore(removed);
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
			{renderToast ? null : (
				<div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
					{toastNode}
				</div>
			)}
		</SavedLayerContext>
	);
};

function clearSelection(): void {
	globalThis.getSelection?.()?.removeAllRanges();
}

/** Paints the chat's saved text wherever its replies are shown under `root`, again after every re-render. */
function useSavedPainter(root: HTMLElement | null, items: readonly SavedItem[]): void {
	useEffect(() => {
		if (!root) return;
		const painter = createSavedPainter();
		const texts = items
			.filter((item) => item.source === CHAT_TEXT_SOURCE)
			.map((item) => parseTextAnchor(item.anchor))
			.filter((anchor) => anchor !== null);
		let frame = 0;
		const paint = () => {
			frame = 0;
			const ranges: Range[] = [];
			for (const anchor of texts) {
				const message = root.querySelector(
					`${MESSAGE}[data-message-id="${CSS.escape(anchor.messageId)}"]`,
				);
				const surfaces = message ? replySurfaces(message) : [];
				if (surfaces.length === 0) continue;
				const range = locateQuote(surfaces, anchor.selector);
				if (range) ranges.push(range);
			}
			painter.paint(ranges);
		};
		paint();
		if (texts.length === 0) return () => painter.dispose();
		const observer = new MutationObserver(() => {
			if (!frame) frame = requestAnimationFrame(paint);
		});
		observer.observe(root, { childList: true, subtree: true, characterData: true });
		return () => {
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
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
function useReplySelection(
	root: HTMLElement | null,
	items: readonly SavedItem[],
): {
	selection: Selection | null;
	showRemove: (item: SavedItem, rect: DOMRect) => void;
} {
	const [selection, setSelection] = useState<Selection | null>(null);
	const latestItems = useRef(items);
	latestItems.current = items;
	const showRemove = useCallback(
		(item: SavedItem, rect: DOMRect) =>
			setSelection({ mode: "remove", rect, item, dismiss: () => setSelection(null) }),
		[],
	);
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
			const inside = (node: Node) => surfaces.some((surface) => surface.contains(node));
			if (!inside(range.startContainer) || !inside(range.endContainer)) return setSelection(null);
			const quote = quoteOf(surfaces, range);
			if (!quote) return setSelection(null);
			setSelection({
				mode: "save",
				rect: range.getBoundingClientRect(),
				messageId,
				quote,
				dismiss,
			});
		};
		const onUp = (event: Event) => requestAnimationFrame(() => read(event));
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.shiftKey || event.key.startsWith("Arrow")) read(event);
		};
		const onScroll = () => setSelection(null);
		root.addEventListener("pointerup", onUp);
		root.addEventListener("keyup", onKeyUp);
		root.addEventListener("scroll", onScroll, { capture: true, passive: true });
		return () => {
			root.removeEventListener("pointerup", onUp);
			root.removeEventListener("keyup", onKeyUp);
			root.removeEventListener("scroll", onScroll, { capture: true });
		};
	}, [root]);
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
