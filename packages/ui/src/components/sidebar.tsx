"use client";

import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import {
	animate,
	motion,
	useMotionValue,
	useReducedMotion,
	useTransform,
	type MotionValue,
} from "motion/react";

import { SHELL_LAYOUT_SNAP, SHELL_LAYOUT_SPRING } from "@kilo-desktop/ui/lib/shell-motion";
import {
	clampSidebarWidth,
	readStoredSidebarWidth,
	SIDEBAR_WIDTH_MIN,
	writeStoredSidebarWidth,
} from "@kilo-desktop/ui/lib/sidebar-width";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { Button } from "@kilo-desktop/ui/components/button";
import { Input } from "@kilo-desktop/ui/components/input";
import { Separator } from "@kilo-desktop/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@kilo-desktop/ui/components/sheet";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { PanelLeftIcon, SearchIcon } from "lucide-react";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";
const SIDEBAR_HOVER_CLOSE_DELAY_MS = 200;

type SidebarContextProps = {
	state: "expanded" | "collapsed";
	open: boolean;
	setOpen: (open: boolean) => void;
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
	isMobile: boolean;
	toggleSidebar: () => void;
	progress: MotionValue<number>;
	transientOpen: boolean;
	setTransientOpen: (open: boolean) => void;
	cancelTransientClose: () => void;
	scheduleTransientClose: () => void;
	panelProgress: MotionValue<number>;
	width: number;
	setWidth: (width: number) => void;
	widthPx: MotionValue<number>;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function isSidebarHoverTarget(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		target.closest('[data-sidebar="sidebar"], [data-sidebar="trigger"]') !== null
	);
}

function useSidebar() {
	const context = React.useContext(SidebarContext);
	if (!context) {
		throw new Error("useSidebar must be used within a SidebarProvider.");
	}

	return context;
}

function SidebarProvider({
	defaultOpen = true,
	open: openProp,
	onOpenChange: setOpenProp,
	hoverReveal = false,
	className,
	style,
	children,
	...props
}: React.ComponentProps<"div"> & {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hoverReveal?: boolean;
}) {
	const isMobile = false;
	const [openMobile, setOpenMobile] = React.useState(false);
	const reduceMotion = useReducedMotion();

	// This is the internal state of the sidebar.
	// We use openProp and setOpenProp for control from outside the component.
	const [_open, _setOpen] = React.useState(defaultOpen);
	const open = openProp ?? _open;
	// Persistent progress reserves layout space. Panel progress can reveal the
	// collapsed sidebar over the page without moving the page underneath it.
	const progress = useMotionValue(open ? 1 : 0);
	const [transientOpen, _setTransientOpen] = React.useState(false);
	const panelProgress = useMotionValue(open ? 1 : 0);
	const transientCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancelTransientClose = React.useCallback(() => {
		if (transientCloseTimer.current === null) return;
		clearTimeout(transientCloseTimer.current);
		transientCloseTimer.current = null;
	}, []);
	// Expanded width is independent of open/collapsed. Drag the rail to change
	// it; collapse still animates from this value. localStorage restores it.
	const [width, _setWidth] = React.useState(readStoredSidebarWidth);
	const widthPx = useMotionValue(width);
	const setWidth = React.useCallback(
		(value: number) => {
			const next = clampSidebarWidth(value);
			_setWidth(next);
			widthPx.set(next);
		},
		[widthPx],
	);
	const setOpen = React.useCallback(
		(value: boolean | ((value: boolean) => boolean)) => {
			const openState = typeof value === "function" ? value(open) : value;
			cancelTransientClose();
			if (setOpenProp) {
				setOpenProp(openState);
			} else {
				_setOpen(openState);
			}
			_setTransientOpen(false);

			// This sets the cookie to keep the sidebar state.
			document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
			void animate(
				progress,
				openState ? 1 : 0,
				reduceMotion ? SHELL_LAYOUT_SNAP : SHELL_LAYOUT_SPRING,
			);
			void animate(
				panelProgress,
				openState ? 1 : 0,
				reduceMotion ? SHELL_LAYOUT_SNAP : SHELL_LAYOUT_SPRING,
			);
		},
		[cancelTransientClose, setOpenProp, open, progress, panelProgress, reduceMotion],
	);
	const setTransientOpen = React.useCallback(
		(value: boolean) => {
			const next = hoverReveal && !open && value;
			_setTransientOpen(next);
			void animate(
				panelProgress,
				open || next ? 1 : 0,
				reduceMotion ? SHELL_LAYOUT_SNAP : SHELL_LAYOUT_SPRING,
			);
		},
		[hoverReveal, open, panelProgress, reduceMotion],
	);
	const scheduleTransientClose = React.useCallback(() => {
		if (open) return;
		cancelTransientClose();
		transientCloseTimer.current = setTimeout(() => {
			transientCloseTimer.current = null;
			setTransientOpen(false);
		}, SIDEBAR_HOVER_CLOSE_DELAY_MS);
	}, [cancelTransientClose, open, setTransientOpen]);

	React.useEffect(() => cancelTransientClose, [cancelTransientClose]);

	// Helper to toggle the sidebar.
	const toggleSidebar = React.useCallback(() => {
		return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
	}, [isMobile, setOpen, setOpenMobile]);

	// Adds a keyboard shortcut to toggle the sidebar.
	React.useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				toggleSidebar();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [toggleSidebar]);

	// We add a state so that we can do data-state="expanded" or "collapsed".
	// This makes it easier to style the sidebar with Tailwind classes.
	const state = open ? "expanded" : "collapsed";

	const contextValue = React.useMemo<SidebarContextProps>(
		() => ({
			state,
			open,
			setOpen,
			isMobile,
			openMobile,
			setOpenMobile,
			toggleSidebar,
			progress,
			transientOpen,
			setTransientOpen,
			cancelTransientClose,
			scheduleTransientClose,
			panelProgress,
			width,
			setWidth,
			widthPx,
		}),
		[
			state,
			open,
			setOpen,
			isMobile,
			openMobile,
			setOpenMobile,
			toggleSidebar,
			progress,
			transientOpen,
			setTransientOpen,
			cancelTransientClose,
			scheduleTransientClose,
			panelProgress,
			width,
			setWidth,
			widthPx,
		],
	);

	return (
		<SidebarContext.Provider value={contextValue}>
			<div
				data-slot="sidebar-wrapper"
				style={
					{
						"--sidebar-width": `${width}px`,
						"--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
						...style,
					} as React.CSSProperties
				}
				className={cn(
					"group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		</SidebarContext.Provider>
	);
}

function Sidebar({
	side = "left",
	variant = "sidebar",
	collapsible = "offcanvas",
	className,
	children,
	dir,
	onClickCapture,
	onPointerEnter,
	onPointerLeave,
	...props
}: React.ComponentProps<"div"> & {
	side?: "left" | "right";
	variant?: "sidebar" | "floating" | "inset";
	collapsible?: "offcanvas" | "icon" | "none";
}) {
	const {
		isMobile,
		state,
		openMobile,
		setOpenMobile,
		progress,
		transientOpen,
		setTransientOpen,
		cancelTransientClose,
		scheduleTransientClose,
		panelProgress,
		widthPx,
	} = useSidebar();
	const gapWidth = useTransform(
		[progress, widthPx],
		([nextProgress, nextWidth]) => (nextWidth as number) * (nextProgress as number),
	);
	const offcanvasOffset = useTransform(
		[panelProgress, widthPx],
		([nextProgress, nextWidth]) => -(nextWidth as number) * (1 - (nextProgress as number)),
	);

	if (collapsible === "none") {
		return (
			<div
				data-slot="sidebar"
				className={cn(
					"flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		);
	}

	if (isMobile) {
		return (
			<Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
				<SheetContent
					dir={dir}
					data-sidebar="sidebar"
					data-slot="sidebar"
					data-mobile="true"
					className="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
					style={
						{
							"--sidebar-width": SIDEBAR_WIDTH_MOBILE,
						} as React.CSSProperties
					}
					side={side}
				>
					<SheetHeader className="sr-only">
						<SheetTitle>Sidebar</SheetTitle>
						<SheetDescription>Displays the mobile sidebar.</SheetDescription>
					</SheetHeader>
					<div className="flex h-full w-full flex-col">{children}</div>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<div
			className="group peer text-sidebar-foreground block"
			data-state={state}
			data-collapsible={state === "collapsed" ? collapsible : ""}
			data-variant={variant}
			data-side={side}
			data-slot="sidebar"
			data-transient={transientOpen || undefined}
		>
			<motion.div
				data-slot="sidebar-gap"
				className="relative bg-transparent group-data-[side=right]:rotate-180"
				style={{ width: gapWidth }}
			/>
			<motion.div
				data-slot="sidebar-container"
				data-side={side}
				style={side === "left" ? { left: offcanvasOffset } : { right: offcanvasOffset }}
				className={cn(
					"fixed inset-y-0 z-10 flex h-svh w-(--sidebar-width) group-data-[transient=true]:z-40",
					variant === "floating" || variant === "inset"
						? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
						: "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
					className,
				)}
			>
				<div
					data-sidebar="sidebar"
					data-slot="sidebar-inner"
					className="bg-sidebar group-data-[variant=floating]:ring-sidebar-border flex size-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1"
					onPointerEnter={(event) => {
						onPointerEnter?.(event);
						if (!event.defaultPrevented) {
							cancelTransientClose();
							setTransientOpen(true);
						}
					}}
					onPointerLeave={(event) => {
						onPointerLeave?.(event);
						if (!event.defaultPrevented && !isSidebarHoverTarget(event.relatedTarget)) {
							scheduleTransientClose();
						}
					}}
					onClickCapture={(event) => {
						onClickCapture?.(event);
						const target = event.target;
						if (
							target instanceof Element &&
							(target.closest("a[href]") !== null ||
								target.closest("[data-sidebar-select]") !== null)
						) {
							cancelTransientClose();
							setTransientOpen(false);
						}
					}}
					{...props}
				>
					{children}
				</div>
				<SidebarRail />
			</motion.div>
		</div>
	);
}

function SidebarTrigger({
	className,
	onClick,
	onPointerEnter,
	onPointerLeave,
	...props
}: React.ComponentProps<typeof Button>) {
	const { toggleSidebar, setTransientOpen, cancelTransientClose, scheduleTransientClose } =
		useSidebar();

	return (
		<Button
			data-sidebar="trigger"
			data-slot="sidebar-trigger"
			variant="ghost"
			size="icon-sm"
			className={cn(className)}
			onPointerEnter={(event) => {
				onPointerEnter?.(event);
				if (!event.defaultPrevented) {
					cancelTransientClose();
					setTransientOpen(true);
				}
			}}
			onPointerLeave={(event) => {
				onPointerLeave?.(event);
				if (!event.defaultPrevented && !isSidebarHoverTarget(event.relatedTarget)) {
					scheduleTransientClose();
				}
			}}
			onClick={(event) => {
				onClick?.(event);
				toggleSidebar();
			}}
			{...props}
		>
			<PanelLeftIcon />
			<span className="sr-only">Toggle Sidebar</span>
		</Button>
	);
}

function SidebarRail({ className, ...props }: React.ComponentProps<"div">) {
	const { toggleSidebar, setWidth, width, open, setOpen, isMobile } = useSidebar();

	if (isMobile) return null;

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize sidebar"
			aria-valuenow={width}
			aria-valuemin={SIDEBAR_WIDTH_MIN}
			data-sidebar="rail"
			data-slot="sidebar-rail"
			data-qa-id="sidebar-resize"
			onPointerDown={(event) => {
				if (event.button > 0) return;
				event.preventDefault();
				const handle = event.currentTarget;
				const side =
					handle.closest("[data-side]")?.getAttribute("data-side") === "right" ? "right" : "left";
				const startX = event.clientX;
				const startWidth = width;
				let moved = false;
				let latest = startWidth;
				let expanded = open;

				const onMove = (moveEvent: PointerEvent) => {
					const delta = side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
					if (Math.abs(delta) < 3) return;
					moved = true;
					if (!expanded) {
						expanded = true;
						setOpen(true);
					}
					latest = startWidth + delta;
					setWidth(latest);
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
					if (!moved) {
						if (!expanded) toggleSidebar();
						return;
					}
					writeStoredSidebarWidth(latest);
				};

				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
			}}
			className={cn(
				"absolute inset-y-0 z-20 flex w-4 touch-none select-none group-data-[side=left]:-right-4 group-data-[side=right]:left-0 ltr:-translate-x-1/2 rtl:-translate-x-1/2",
				"before:bg-transparent hover:before:bg-muted-foreground/35 active:before:bg-muted-foreground/60 cursor-col-resize before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:transition-colors before:duration-150 before:content-[''] motion-reduce:before:transition-none",
				"group-data-[collapsible=offcanvas]:translate-x-0",
				"[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
				"[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
	return (
		<main
			data-slot="sidebar-inset"
			className={cn(
				"relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
	return (
		<Input
			data-slot="sidebar-input"
			data-sidebar="input"
			className={cn("h-8 w-full bg-background shadow-none", className)}
			{...props}
		/>
	);
}

function SidebarSearch({ className, ...props }: React.ComponentProps<typeof Input>) {
	return (
		<div
			data-slot="sidebar-search"
			data-sidebar="search"
			className="hover:bg-foreground/5 focus-within:bg-foreground/5 flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors"
		>
			<SearchIcon className="text-muted-foreground pointer-events-none size-3.5 shrink-0" />
			<Input
				type="search"
				data-slot="sidebar-search-input"
				className={cn(
					"h-8 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none",
					"dark:bg-transparent",
					"focus-visible:border-0 focus-visible:ring-0",
					"text-sidebar-foreground",
					"rounded-md!",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-header"
			data-sidebar="header"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-footer"
			data-sidebar="footer"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
	return (
		<Separator
			data-slot="sidebar-separator"
			data-sidebar="separator"
			className={cn("mx-2 w-auto bg-sidebar-border", className)}
			{...props}
		/>
	);
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-content"
			data-sidebar="content"
			className={cn(
				"no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group"
			data-sidebar="group"
			className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
			{...props}
		/>
	);
}

function SidebarGroupLabel({
	className,
	render,
	...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-3.5 [&>svg]:shrink-0",
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "sidebar-group-label",
			sidebar: "group-label",
		},
	});
}

function SidebarGroupAction({
	className,
	render,
	...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
	return useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(
			{
				className: cn(
					"absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-foreground/5 hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-3.5 [&>svg]:shrink-0",
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "sidebar-group-action",
			sidebar: "group-action",
		},
	});
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group-content"
			data-sidebar="group-content"
			className={cn("w-full text-sm", className)}
			{...props}
		/>
	);
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="sidebar-menu"
			data-sidebar="menu"
			className={cn("flex w-full min-w-0 flex-col gap-0", className)}
			{...props}
		/>
	);
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="sidebar-menu-item"
			data-sidebar="menu-item"
			className={cn("group/menu-item relative", className)}
			{...props}
		/>
	);
}

const sidebarMenuButtonVariants = cva(
	"peer/menu-button group/menu-button flex w-full items-center gap-1.5 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-foreground/5 hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-foreground/6 active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-foreground/5 data-open:hover:text-sidebar-accent-foreground data-active:bg-muted data-active:hover:bg-muted data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&>span:last-child]:truncate",
	{
		variants: {
			variant: {
				default: "hover:bg-foreground/5 hover:text-sidebar-accent-foreground",
				outline:
					"bg-background/60 shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-foreground/5 hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
			},
			size: {
				default: "h-8 text-sm",
				sm: "h-7 text-xs",
				lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function SidebarMenuButton({
	render,
	isActive = false,
	variant = "default",
	size = "default",
	tooltip,
	className,
	...props
}: useRender.ComponentProps<"button"> &
	React.ComponentProps<"button"> & {
		isActive?: boolean;
		tooltip?: string | React.ComponentProps<typeof TooltipContent>;
	} & VariantProps<typeof sidebarMenuButtonVariants>) {
	const { isMobile, state } = useSidebar();
	const comp = useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(
			{
				className: cn(sidebarMenuButtonVariants({ variant, size }), className),
			},
			props,
		),
		render: !tooltip ? render : <TooltipTrigger render={render} />,
		state: {
			slot: "sidebar-menu-button",
			sidebar: "menu-button",
			size,
			active: isActive,
		},
	});

	if (!tooltip) {
		return comp;
	}

	if (typeof tooltip === "string") {
		tooltip = {
			children: tooltip,
		};
	}

	return (
		<Tooltip>
			{comp}
			<TooltipContent
				side="right"
				align="center"
				hidden={state !== "collapsed" || isMobile}
				{...tooltip}
			/>
		</Tooltip>
	);
}

function SidebarMenuAction({
	className,
	render,
	showOnHover = false,
	...props
}: useRender.ComponentProps<"button"> &
	React.ComponentProps<"button"> & {
		showOnHover?: boolean;
	}) {
	return useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(
			{
				className: cn(
					"absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-foreground/5 hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-3.5 [&>svg]:shrink-0",
					showOnHover &&
						"group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "sidebar-menu-action",
			sidebar: "menu-action",
		},
	});
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-menu-badge"
			data-sidebar="menu-badge"
			className={cn(
				"pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarMenuSkeleton({
	className,
	showIcon = false,
	...props
}: React.ComponentProps<"div"> & {
	showIcon?: boolean;
}) {
	// Random width between 50 to 90%.
	const [width] = React.useState(() => {
		return `${Math.floor(Math.random() * 40) + 50}%`;
	});

	return (
		<div
			data-slot="sidebar-menu-skeleton"
			data-sidebar="menu-skeleton"
			className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
			{...props}
		>
			{showIcon && <Skeleton className="size-4 rounded-md" data-sidebar="menu-skeleton-icon" />}
			<Skeleton
				className="h-4 max-w-(--skeleton-width) flex-1"
				data-sidebar="menu-skeleton-text"
				style={
					{
						"--skeleton-width": width,
					} as React.CSSProperties
				}
			/>
		</div>
	);
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="sidebar-menu-sub"
			data-sidebar="menu-sub"
			className={cn(
				"mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="sidebar-menu-sub-item"
			data-sidebar="menu-sub-item"
			className={cn("group/menu-sub-item relative", className)}
			{...props}
		/>
	);
}

function SidebarMenuSubButton({
	render,
	size = "md",
	isActive = false,
	className,
	...props
}: useRender.ComponentProps<"a"> &
	React.ComponentProps<"a"> & {
		size?: "sm" | "md";
		isActive?: boolean;
	}) {
	return useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(
			{
				className: cn(
					"flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-foreground/5 hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-foreground/6 active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-muted data-active:hover:bg-muted data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "sidebar-menu-sub-button",
			sidebar: "menu-sub-button",
			size,
			active: isActive,
		},
	});
}

export {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarSearch,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
};
