import { useRef, useState, type RefObject } from "react";
import { XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { ResizableHandle } from "@kilo-desktop/ui/components/resizable";
import { SHELL_LAYOUT_SNAP, SHELL_LAYOUT_SPRING } from "@kilo-desktop/ui/lib/shell-motion";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { RightSidebarPanel, type RightSidebarPanelImplementation } from "../../contracts";
import { useRightSidebar, useShellUi } from "./ui-state";

type Panel = Contribution<typeof RightSidebarPanel>;

const widthKey = (panel: string) => `kilo.shell.right-sidebar-width:${panel}`;
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;

const selectComponent = (implementation: RightSidebarPanelImplementation) =>
	implementation.component;

function clampWidth(width: number, max = Number.POSITIVE_INFINITY): number {
	return Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, max)));
}

function storedWidth(panel: Panel): number {
	const stored = Number(localStorage.getItem(widthKey(panel.key)));
	const preferred = panel.metadata.width ?? DEFAULT_WIDTH;
	return clampWidth(Number.isFinite(stored) && stored > 0 ? stored : preferred);
}

/**
 * A panel's width, dragged from the splitter on its left edge and remembered
 * per panel across launches. It can grow to take the whole content area,
 * leaving the main area no width at all.
 *
 * The panel shrinks in CSS when the window can't fit its width, so what shows
 * is `min(width, room)`, where the room is the panel's and the main area's
 * widths together. The handle reports travel since the drag started and keeps
 * its pointerdown-time callback (so `width` there is the drag-start width);
 * the room doesn't change during a drag, so a drag starts from what shows,
 * not from a remembered width the window has squeezed.
 */
function usePanelWidth(panel: Panel, main: RefObject<HTMLElement | null>) {
	const aside = useRef<HTMLElement>(null);
	const [width, setWidth] = useState(() => storedWidth(panel));
	const resize = (delta: number) => {
		const room = (aside.current?.offsetWidth ?? 0) + (main.current?.offsetWidth ?? 0);
		const next = clampWidth(Math.min(width, room) - delta, room);
		localStorage.setItem(widthKey(panel.key), String(next));
		setWidth(next);
	};
	return { aside, width, resize };
}

function Rail({
	panels,
	open,
	onToggle,
}: {
	readonly panels: readonly Panel[];
	readonly open: string | undefined;
	readonly onToggle: (key: string) => void;
}) {
	return (
		<nav
			aria-label="Right sidebar"
			// pt-1.5 is a work session's pane tab strip padding (p-1.5), so the first icon
			// centres on the panes' tab headers beside it.
			className="flex w-7 shrink-0 flex-col items-center gap-1 pt-1.5"
			data-qa-id="right-sidebar-rail"
		>
			{panels.map((panel) => {
				const Icon = (panel.implementation as RightSidebarPanelImplementation | undefined)?.icon;
				const pressed = panel.key === open;
				return (
					<Button
						key={panel.key}
						variant="ghost"
						size="icon-sm"
						aria-label={panel.metadata.title}
						title={panel.metadata.title}
						aria-pressed={pressed}
						className={cn("text-muted-foreground", pressed && "bg-accent text-accent-foreground")}
						onClick={() => onToggle(panel.key)}
						data-qa-id={`right-sidebar-panel-${panel.key}`}
					>
						{Icon ? <Icon /> : panel.metadata.title.slice(0, 1)}
					</Button>
				);
			})}
		</nav>
	);
}

/**
 * Opens and closes the panel by growing and shrinking its width, with the
 * left sidebar's spring, so the main area eases aside rather than jumping.
 * While the slot animates it clips a panel laid out at its full width (so
 * the panel's content doesn't reflow every frame) and drops the splitter and
 * the minimum width; once settled its width is `auto` again, and the panel
 * resizes from its splitter and gives way to a narrowing window. Switching
 * panels keeps the slot, so it swaps without animating.
 */
function PanelSlot({
	panel,
	main,
	onClose,
}: {
	readonly panel: Panel;
	readonly main: RefObject<HTMLElement | null>;
	readonly onClose: () => void;
}) {
	const reduceMotion = useReducedMotion();
	const [settled, setSettled] = useState(false);
	return (
		<motion.div
			className={cn(
				"flex min-h-0",
				settled ? "min-w-[calc(280px+--spacing(1.5))]" : "overflow-hidden",
			)}
			// A one-shot reveal that must reflow the main pane; it snaps under reduced motion.
			// react-doctor-disable-next-line react-doctor/no-layout-property-animation
			initial={{ width: 0 }}
			// react-doctor-disable-next-line react-doctor/no-layout-property-animation
			animate={{ width: "auto" }}
			// react-doctor-disable-next-line react-doctor/no-layout-property-animation
			exit={{ width: 0 }}
			transition={reduceMotion ? SHELL_LAYOUT_SNAP : SHELL_LAYOUT_SPRING}
			onAnimationStart={() => setSettled(false)}
			onAnimationComplete={() => setSettled(true)}
			data-qa-id="right-sidebar-slot"
		>
			<OpenPanel key={panel.key} panel={panel} main={main} settled={settled} onClose={onClose} />
		</motion.div>
	);
}

function OpenPanel({
	panel,
	main,
	settled,
	onClose,
}: {
	readonly panel: Panel;
	readonly main: RefObject<HTMLElement | null>;
	readonly settled: boolean;
	readonly onClose: () => void;
}) {
	const { aside, width, resize } = usePanelWidth(panel, main);
	return (
		// The panel sits straight after the main area's own inset (no gap of its own), and
		// the zero-width anchor centres the splitter in that inset.
		<>
			{settled ? (
				<div className="relative w-0 shrink-0">
					<ResizableHandle
						ariaLabel="Resize right sidebar"
						className="right-auto left-[calc(var(--shell-main-inset)/-2_-_0.25rem)]"
						onResize={resize}
						qaId="right-sidebar-resize"
					/>
				</div>
			) : null}
			<aside
				ref={aside}
				aria-label={panel.metadata.title}
				data-qa-id="right-sidebar"
				className={cn(
					"bg-card pane-edge mr-1.5 flex min-h-0 flex-col overflow-hidden rounded-lg [--pane-surface:var(--color-card)]",
					settled ? "min-w-[280px] shrink" : "shrink-0",
				)}
				style={{ width }}
			>
				<header className="flex h-10 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
					<h2 className="min-w-0 flex-1 truncate text-sm font-medium">{panel.metadata.title}</h2>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Close ${panel.metadata.title}`}
						className="text-muted-foreground"
						onClick={onClose}
						data-qa-id="right-sidebar-close"
					>
						<XIcon />
					</Button>
				</header>
				<div
					className="flex min-h-0 flex-1 flex-col overflow-y-auto"
					data-qa-id="right-sidebar-body"
				>
					<RenderContribution contribution={panel} select={selectComponent} />
				</div>
			</aside>
		</>
	);
}

/**
 * The right sidebar: a narrow rail of `right-sidebar-panel` icons along the
 * window's right edge and, beside the main area behind a splitter, the one
 * panel open. It sits under the top bar, which keeps the full width.
 * Which panel is open is this window's alone; absent while nothing is
 * contributed. `main` is the main area, whose width the panel can take.
 */
export function RightSidebar({ main }: { readonly main: RefObject<HTMLElement | null> }) {
	const ui = useShellUi();
	const { open, selected } = useRightSidebar();
	const panels = useExtensions(RightSidebarPanel);
	if (panels.length === 0) return null;
	const current = open ? panels.find((panel) => panel.key === selected) : undefined;
	const toggle = (key: string) =>
		ui.setRightSidebar(current?.key === key ? { open: false } : { open: true, selected: key });
	return (
		<div className="mr-2 mb-2 flex min-h-0 min-w-0" data-qa-id="right-sidebar-area">
			<AnimatePresence initial={false}>
				{current ? (
					<PanelSlot
						key="panel"
						panel={current}
						main={main}
						onClose={() => ui.setRightSidebar({ open: false })}
					/>
				) : null}
			</AnimatePresence>
			<Rail panels={panels} open={current?.key} onToggle={toggle} />
		</div>
	);
}
