import { CheckIcon, CopyIcon } from "lucide-react";
import {
	createContext,
	useContext,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";

import { MediaLightbox, type LightboxItem } from "@kilo-desktop/ui/components/media-lightbox";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import { toLightboxItem } from "../../media/lightbox-items";
import { useOpenMediaPane, type ViewerItem } from "../../media/open-media-pane";
import { TooltipIconButton } from "../tooltip-icon-button";
import { useCopyToClipboard } from "../use-copy-to-clipboard";
import { useShellCopyText } from "../use-shell-copy-text";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a transcript surface offers the viewer; the registry assigns the id. */
export type LightboxItemInput = DistributiveOmit<ViewerItem, "id">;

interface Entry {
	readonly item: ViewerItem;
	readonly element: HTMLElement;
}

interface Registry {
	register(key: string, entry: Entry): () => void;
	open(key: string): void;
}

const RegistryContext = createContext<Registry | null>(null);

function byDocumentOrder(a: Entry, b: Entry): number {
	return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function CopySourceButton({ code }: { readonly code: string }) {
	const copyText = useShellCopyText();
	const { isCopied, copyToClipboard } = useCopyToClipboard(copyText);
	return (
		<TooltipIconButton
			tooltip="Copy source"
			size="icon-sm"
			data-qa-id="chat-lightbox-copy-source"
			onClick={() => {
				if (!isCopied) copyToClipboard(code);
			}}
		>
			{isCopied ? <CheckIcon /> : <CopyIcon />}
		</TooltipIconButton>
	);
}

/** kilo.chat's actions on a viewed item: copying a diagram's source. */
export function renderChatLightboxActions(item: LightboxItem): ReactNode {
	return item.kind === "mermaid" ? <CopySourceButton code={item.code} /> : null;
}

/**
 * One viewer per transcript, shared by its diagrams, images and pages.
 *
 * Surfaces register an item with the element it renders in; opening one
 * orders them by document position, so ←/→ walks the transcript top to
 * bottom. Items in messages the transcript has windowed out unregister as they
 * unmount, so ←/→ only reaches mounted messages. In a session's
 * transcript the items open in its media viewer pane; elsewhere (the New
 * Session page, the web build without plugin main entries) in a lightbox
 * dialog. Registration lives in state here and the context value is stable,
 * so a registration re-renders only the lightbox, never the transcript.
 */
export function ChatLightboxProvider({ children }: { readonly children: ReactNode }) {
	const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(() => new Map());
	const [openKey, setOpenKey] = useState<string | null>(null);
	const openMediaPane = useOpenMediaPane();
	const latestOpenMediaPane = useLatestRef(openMediaPane);
	// Registrations land here at once: an item clicked right after it
	// registers is opened before the state below has re-rendered with it.
	const registered = useRef(new Map<string, Entry>());

	const [registry] = useState<Registry>(() => ({
		register(key, entry) {
			registered.current.set(key, entry);
			setEntries((previous) => new Map(previous).set(key, entry));
			return () => {
				if (registered.current.get(key) === entry) registered.current.delete(key);
				setEntries((previous) => {
					if (previous.get(key) !== entry) return previous;
					const next = new Map(previous);
					next.delete(key);
					return next;
				});
			};
		},
		open(key) {
			const openMediaPane = latestOpenMediaPane.current;
			if (!openMediaPane) {
				setOpenKey(key);
				return;
			}
			const items = [...registered.current.values()]
				.sort(byDocumentOrder)
				.map((entry) => entry.item);
			void openMediaPane(items, key).then(
				(opened) => {
					if (!opened) setOpenKey(key);
				},
				() => setOpenKey(key),
			);
		},
	}));

	const ordered =
		openKey === null
			? []
			: [...entries].sort(([, a], [, b]) => byDocumentOrder(a, b)).map(([key]) => key);
	const index = ordered.indexOf(openKey ?? "");
	const items = ordered.flatMap((key) => {
		const item = entries.get(key)?.item;
		return item ? [toLightboxItem(item)] : [];
	});

	return (
		<RegistryContext.Provider value={registry}>
			{children}
			<MediaLightbox
				items={items}
				index={Math.max(index, 0)}
				open={index >= 0}
				onOpenChange={(open) => {
					if (!open) setOpenKey(null);
				}}
				onIndexChange={(next) => setOpenKey(ordered[next] ?? null)}
				renderActions={renderChatLightboxActions}
			/>
		</RegistryContext.Provider>
	);
}

/**
 * Makes a transcript surface openable in the viewer. Attach `ref` to the
 * element the item renders in and call `open()` on activation. With
 * `gallery: false` (or outside a transcript) the item opens on its own; when
 * that's a lightbox, it is returned as `lightbox` for the caller to render.
 *
 * `input` should be memoized: a new object re-registers the item.
 */
export function useLightboxItem(
	input: LightboxItemInput | null,
	{ gallery = true }: { readonly gallery?: boolean } = {},
) {
	const registry = useContext(RegistryContext);
	const openMediaPane = useOpenMediaPane();
	const shared = gallery ? registry : null;
	const key = useId();
	// The element is read from a ref so the item registers in the same commit
	// that makes it openable; the state only re-registers a replaced element.
	const elementRef = useRef<HTMLElement | null>(null);
	const [element, setElement] = useState<HTMLElement | null>(null);
	const ref = (node: HTMLElement | null) => {
		elementRef.current = node;
		setElement(node);
	};
	const [localOpen, setLocalOpen] = useState(false);
	const item = input ? ({ ...input, id: key } as ViewerItem) : null;

	useLayoutEffect(() => {
		const current = elementRef.current;
		if (!shared || !item || !current) return;
		// A replaced element registers on the render that catches its state up.
		if (element !== null && element !== current) return;
		return shared.register(key, { item, element: current });
	}, [shared, item, element, key]);

	const open = () => {
		if (!item) return;
		if (shared) shared.open(key);
		else if (openMediaPane) {
			void openMediaPane([item], key).then(
				(opened) => {
					if (!opened) setLocalOpen(true);
				},
				() => setLocalOpen(true),
			);
		} else setLocalOpen(true);
	};

	const lightbox =
		!shared && item ? (
			<MediaLightbox
				items={[toLightboxItem(item)]}
				index={0}
				onIndexChange={() => {}}
				open={localOpen}
				onOpenChange={setLocalOpen}
				renderActions={renderChatLightboxActions}
			/>
		) : null;

	return { ref, open, lightbox, available: item !== null };
}
