import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import {
	memo,
	useLayoutEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
	type ComponentType,
	type FC,
} from "react";

/*
 * Message windowing. A transcript mounts only the messages near what the
 * viewport shows; the rest are placeholders of their last measured height,
 * carrying their `data-message-id` so the conversation map still finds and
 * measures every turn. Opening a long session therefore renders a screenful
 * instead of every message, and a streamed token only re-runs the selectors
 * of the messages that are mounted.
 *
 * - The newest messages (the current turn and the answer before it) are
 *   always mounted: autoscroll follows them and the run's state lives there.
 * - One pass per frame, on scroll, on resize and after mounts, decides what
 *   is mounted. Messages stack in order, so the first one near the viewport
 *   is found by bisection; it mounts those within MOUNT_MARGIN viewports and
 *   unmounts the mounted ones beyond UNMOUNT_MARGIN. The gap between the two
 *   keeps a scroll back and forth from thrashing. (IntersectionObservers did
 *   this, but could miss a transition and leave placeholders unmounted.)
 * - A message's height is taken as it unmounts, so its placeholder keeps the
 *   scroll height the same; one never measured uses the mean of those that
 *   were.
 * - Mounting is spread over frames, nearest the viewport first: a fling
 *   across a long session would otherwise mount dozens of messages in one
 *   frame. The margin mounts ahead of normal scrolling, so a placeholder is
 *   only ever seen during a fast one.
 * - Chromium's scroll anchoring keeps what the reader sees still while a
 *   placeholder above the viewport turns into a message of another height.
 * - The viewport is found from the DOM, not assistant-ui's viewport state,
 *   which can drop its element during a re-render while the element stays.
 * - `disabled` mounts everything: the find bar searches the DOM.
 */

/** Always mounted: the current turn and the response before it. */
const ALWAYS_MOUNTED_TAIL = 4;
/** Within this many viewport heights above or below the viewport, a message mounts. */
const MOUNT_MARGIN = 1.5;
/** Beyond this many, a mounted message unmounts. */
const UNMOUNT_MARGIN = 4;
const DEFAULT_HEIGHT = 200;
/** The live thread's viewport, or the read-only one a subagent transcript scrolls in. */
const VIEWPORT_SELECTOR =
	'[data-slot="aui_thread-viewport"], [data-slot="aui_readonly-thread-viewport"]';
const WINDOW_SELECTOR = '[data-slot="aui_message-window"]';
/** Messages mounted per frame, nearest the viewport first, so a fast scroll never stalls a frame. */
const MOUNTS_PER_FRAME = 3;

type Listener = () => void;

interface MessageWindowStore {
	isMounted(id: string): boolean;
	subscribe(id: string, listener: Listener): () => void;
	observe(id: string, element: Element): () => void;
	heightOf(id: string): number;
	/** Follows the thread viewport holding the messages, reconnecting if it changed. */
	connectToViewport(): void;
	disconnect(): void;
}

function createMessageWindowStore(): MessageWindowStore {
	const mounted = new Set<string>();
	const heights = new Map<string, number>();
	const listeners = new Map<string, Set<Listener>>();
	const elements = new Map<string, Element>();
	const idOf = new WeakMap<Element, string>();
	let measuredTotal = 0;
	let root: Element | null = null;
	let frame = 0;
	let stopFollowing: (() => void) | null = null;

	const notify = (id: string) => {
		for (const listener of listeners.get(id) ?? []) listener();
	};
	const setMounted = (id: string, value: boolean) => {
		if (mounted.has(id) === value) return;
		if (value) mounted.add(id);
		else mounted.delete(id);
		notify(id);
	};
	const remember = (id: string, height: number) => {
		if (height <= 0) return;
		const previous = heights.get(id);
		measuredTotal += height - (previous ?? 0);
		heights.set(id, height);
	};

	/** The first index in `windows` whose box reaches below `top`. */
	const firstReaching = (windows: NodeListOf<Element>, top: number) => {
		let low = 0;
		let high = windows.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (windows[middle]!.getBoundingClientRect().bottom < top) low = middle + 1;
			else high = middle;
		}
		return low;
	};

	const update = () => {
		frame = 0;
		if (!root?.isConnected) return;
		const bounds = root.getBoundingClientRect();
		const height = bounds.height || window.innerHeight;

		for (const id of mounted) {
			const box = elements.get(id)?.getBoundingClientRect();
			if (!box) continue;
			if (
				box.bottom < bounds.top - height * UNMOUNT_MARGIN ||
				box.top > bounds.bottom + height * UNMOUNT_MARGIN
			) {
				remember(id, box.height);
				setMounted(id, false);
			}
		}

		const top = bounds.top - height * MOUNT_MARGIN;
		const bottom = bounds.bottom + height * MOUNT_MARGIN;
		const windows = root.querySelectorAll(WINDOW_SELECTOR);
		const wanted: Array<readonly [string, number]> = [];
		for (let index = firstReaching(windows, top); index < windows.length; index += 1) {
			const element = windows[index]!;
			const box = element.getBoundingClientRect();
			if (box.top > bottom) break;
			const id = idOf.get(element);
			if (id === undefined || mounted.has(id)) continue;
			wanted.push([id, Math.max(0, bounds.top - box.bottom, box.top - bounds.bottom)]);
		}
		wanted.sort((a, b) => a[1] - b[1]);
		for (const [id] of wanted.slice(0, MOUNTS_PER_FRAME)) setMounted(id, true);
		// What just mounted moved what's below it; the rest wait for the next frame.
		if (wanted.length > 0) schedule();
	};
	const schedule = () => {
		if (!frame && root) frame = requestAnimationFrame(update);
	};

	const connect = (viewport: Element) => {
		root = viewport;
		viewport.addEventListener("scroll", schedule, { passive: true });
		const resizes = new ResizeObserver(schedule);
		resizes.observe(viewport);
		stopFollowing = () => {
			viewport.removeEventListener("scroll", schedule);
			resizes.disconnect();
		};
		schedule();
	};
	const disconnect = () => {
		cancelAnimationFrame(frame);
		frame = 0;
		stopFollowing?.();
		stopFollowing = null;
		root = null;
	};

	return {
		isMounted: (id) => mounted.has(id),
		subscribe(id, listener) {
			let set = listeners.get(id);
			if (!set) listeners.set(id, (set = new Set()));
			set.add(listener);
			return () => {
				set.delete(listener);
				if (set.size === 0) listeners.delete(id);
			};
		},
		observe(id, element) {
			elements.set(id, element);
			idOf.set(element, id);
			schedule();
			return () => {
				if (elements.get(id) === element) elements.delete(id);
			};
		},
		heightOf: (id) =>
			heights.get(id) ?? (heights.size > 0 ? measuredTotal / heights.size : DEFAULT_HEIGHT),
		connectToViewport() {
			const viewport = viewportOf(elements);
			if (viewport === root) return;
			disconnect();
			if (viewport) connect(viewport);
		},
		disconnect,
	};
}

/** The scroll container the messages are in. */
function viewportOf(elements: ReadonlyMap<string, Element>): Element | null {
	for (const element of elements.values()) {
		if (!element.isConnected) continue;
		const viewport = element.closest(VIEWPORT_SELECTOR);
		if (viewport) return viewport;
	}
	return null;
}

/** The thread's message ids, keeping one array while the sequence is unchanged (a token changes none). */
function useMessageIds(): readonly string[] {
	const last = useRef<readonly string[]>([]);
	return useAuiState((s) => {
		const messages = s.thread.messages;
		const previous = last.current;
		if (
			previous.length === messages.length &&
			messages.every((message, index) => message.id === previous[index])
		) {
			return previous;
		}
		return (last.current = messages.map((message) => message.id));
	});
}

const NEVER_SUBSCRIBED = () => () => undefined;

/**
 * One message: its component in its message scope while within the window,
 * else a placeholder of its height with no scope at all, so a streamed token
 * costs a placeholder nothing.
 */
const WindowedMessage = memo(function WindowedMessage({
	store,
	id,
	inTail,
	Message,
}: {
	store: MessageWindowStore | null;
	id: string;
	inTail: boolean;
	Message: ComponentType;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const windowed = useSyncExternalStore(
		store ? (listener) => store.subscribe(id, listener) : NEVER_SUBSCRIBED,
		() => (store ? store.isMounted(id) : true),
	);
	const mounted = !store || inTail || windowed;
	// A message restored from its placeholder is old: it appears without the entrance animation.
	const restored = useRef(false);
	if (!mounted) restored.current = true;

	useLayoutEffect(() => {
		const element = ref.current;
		if (!store || !element) return;
		return store.observe(id, element);
	}, [store, id]);

	return (
		<div
			ref={ref}
			data-slot="aui_message-window"
			className={restored.current ? "flex flex-col [&>*]:animate-none" : "flex flex-col"}
		>
			{mounted ? (
				<ThreadPrimitive.Unstable_MessageById messageId={id} components={{ Message }} />
			) : (
				<div
					aria-hidden
					data-message-id={id}
					data-slot="aui_message-placeholder"
					style={{ height: store?.heightOf(id) ?? DEFAULT_HEIGHT }}
				/>
			)}
		</div>
	);
});

/**
 * The thread's messages, each rendered by `Message`, windowed to those near
 * the viewport (see the module comment); `disabled` mounts them all.
 */
export const WindowedMessages: FC<{ Message: ComponentType; disabled?: boolean }> = ({
	Message,
	disabled = false,
}) => {
	const store = useMemo(createMessageWindowStore, []);
	const ids = useMessageIds();
	// After the messages' own effects have registered them: they say where the viewport is.
	useLayoutEffect(() => store.connectToViewport());
	useLayoutEffect(() => store.disconnect, [store]);
	const active = disabled ? null : store;
	const tailStart = ids.length - ALWAYS_MOUNTED_TAIL;
	return ids.map((id, index) => (
		<WindowedMessage
			key={id}
			store={active}
			id={id}
			inTail={index >= tailStart}
			Message={Message}
		/>
	));
};
