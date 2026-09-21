import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ComponentProps,
	type RefObject,
} from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { PaneTabTooltipScope } from "./PaneTabTooltip.js";

export function PaneTabScrollArea({
	scrollRef,
	tabIds,
	activeTabId,
	children,
	onWheelCapture,
	className,
	...props
}: Omit<ComponentProps<"div">, "ref"> & {
	scrollRef: RefObject<HTMLDivElement | null>;
	tabIds: readonly string[];
	activeTabId: string;
}) {
	const [overflow, setOverflow] = useState({ left: false, right: false });
	const previousTabIds = useRef(tabIds);
	const [scrolling, setScrolling] = useState(false);
	const scrollIdleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const suspendTooltips = useCallback(() => {
		setScrolling(true);
		clearTimeout(scrollIdleTimer.current);
		scrollIdleTimer.current = setTimeout(() => setScrolling(false), 150);
	}, []);

	useEffect(() => () => clearTimeout(scrollIdleTimer.current), []);

	useLayoutEffect(() => {
		const lastTabId = tabIds.at(-1);
		const appended = lastTabId !== undefined && !previousTabIds.current.includes(lastTabId);
		previousTabIds.current = tabIds;
		const strip = scrollRef.current;
		if (strip && appended) {
			strip.scrollTo({ left: strip.scrollWidth, behavior: "instant" });
		}
	}, [scrollRef, tabIds]);

	useLayoutEffect(() => {
		const strip = scrollRef.current;
		if (!strip || !activeTabId) return;
		const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-pane-tab]"));
		const tab = tabs.find((element) => element.dataset.paneTab === activeTabId);
		if (!tab) return;

		const bounds = strip.getBoundingClientRect();
		const tabBounds = tab.getBoundingClientRect();
		const padding = parseFloat(getComputedStyle(strip).scrollPaddingInlineStart) || 0;
		const maxScroll = strip.scrollWidth - strip.clientWidth;
		let target = strip.scrollLeft;
		if (tab === tabs.at(-1)) {
			target = maxScroll;
		} else if (tabBounds.left < bounds.left + padding) {
			target += tabBounds.left - bounds.left - padding;
		} else if (tabBounds.right > bounds.right - padding) {
			target += tabBounds.right - bounds.right + padding;
		}
		target = Math.max(0, Math.min(maxScroll, target));
		if (target !== strip.scrollLeft) {
			suspendTooltips();
			strip.scrollTo({ left: target, behavior: "instant" });
		}
	}, [activeTabId, scrollRef, suspendTooltips]);

	useLayoutEffect(() => {
		const strip = scrollRef.current;
		if (!strip || strip.scrollWidth - strip.clientWidth > 1) return;
		strip.scrollLeft = 0;
		setOverflow({ left: false, right: false });
	}, [scrollRef, tabIds]);

	useLayoutEffect(() => {
		const strip = scrollRef.current;
		if (!strip) return;

		const update = () => {
			const left = strip.scrollLeft > 1;
			const right = strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1;
			setOverflow((previous) =>
				previous.left === left && previous.right === right ? previous : { left, right },
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(strip);
		for (const child of strip.children) observer.observe(child);
		const childrenObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.removedNodes) {
					if (node instanceof Element) observer.unobserve(node);
				}
				for (const node of mutation.addedNodes) {
					if (node instanceof Element) observer.observe(node);
				}
			}
			update();
		});
		childrenObserver.observe(strip, { childList: true });
		const onScroll = () => {
			suspendTooltips();
			update();
		};
		strip.addEventListener("scroll", onScroll, { passive: true });
		update();
		return () => {
			childrenObserver.disconnect();
			observer.disconnect();
			strip.removeEventListener("scroll", onScroll);
		};
	}, [scrollRef, suspendTooltips]);

	const scroll = (direction: number) => {
		const strip = scrollRef.current;
		if (!strip) return;
		suspendTooltips();
		strip.scrollBy({
			left: direction * strip.clientWidth * 0.9,
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	};

	return (
		<PaneTabTooltipScope scrolling={scrolling}>
			<div className="relative min-w-0 shrink-0">
				<div
					ref={scrollRef}
					className={cn(
						className,
						!overflow.left &&
							!overflow.right &&
							"[animation:none] [mask-image:none] [-webkit-mask-image:none]",
					)}
					data-overflow-left={overflow.left || undefined}
					data-overflow-right={overflow.right || undefined}
					{...props}
					onWheelCapture={(event) => {
						suspendTooltips();
						onWheelCapture?.(event);
					}}
				>
					{children}
				</div>
				{overflow.left ? (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Scroll tabs left"
						className="bg-background hover:bg-background text-muted-foreground absolute inset-y-0 left-0 h-full w-5 rounded-none border-0 active:not-aria-[haspopup]:translate-y-0"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							scroll(-1);
						}}
					>
						<ChevronLeftIcon />
					</Button>
				) : null}
				{overflow.right ? (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Scroll tabs right"
						className="bg-background hover:bg-background text-muted-foreground absolute inset-y-0 right-0 h-full w-5 rounded-none border-0 active:not-aria-[haspopup]:translate-y-0"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							scroll(1);
						}}
					>
						<ChevronRightIcon />
					</Button>
				) : null}
			</div>
		</PaneTabTooltipScope>
	);
}
