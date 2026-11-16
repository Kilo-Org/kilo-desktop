import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type ComponentProps,
	type RefObject,
} from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Input } from "@kilo-desktop/ui/components/input";
import { Toggle } from "@kilo-desktop/ui/components/toggle";
import { useDomFind, type DomFindController } from "@kilo-desktop/ui/hooks/use-dom-find";
import { cn } from "@kilo-desktop/ui/lib/utils";

import "./find-bar.css";

const FIND_SCOPE_SELECTOR = "[data-find-scope]";

// `navigator.platform` is deprecated but frozen in Chromium; it is the
// renderer-side platform check the app already relies on.
const IS_MAC = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

/**
 * True for the platform find chord: Cmd+F on macOS, where Ctrl+F moves the
 * caret forward in text fields, and Ctrl+F elsewhere. Layouts whose F key
 * types a non-Latin letter are matched by the physical key instead.
 */
function isFindChord(event: KeyboardEvent): boolean {
	const primary = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	if (!primary || event.altKey || event.shiftKey) return false;
	const key = event.key.toLowerCase();
	return /^[a-z]$/u.test(key) ? key === "f" : event.code === "KeyF";
}

/**
 * The single find scope that answers the chord, so every bar in the window
 * agrees on one winner:
 * - the scope holding focus;
 * - otherwise the scope in the active pane;
 * - otherwise, when the window has no panes (a popped-out window, or the chat
 *   without a canvas), its only scope.
 *
 * Only rendered scopes count: a pane group keeps its parked tabs mounted but
 * hidden inside the active pane. `null` leaves the chord alone, so a focused
 * surface with its own search (e.g. a code editor) still receives it.
 */
function chordTarget(): HTMLElement | null {
	const scopes = Array.from(document.querySelectorAll<HTMLElement>(FIND_SCOPE_SELECTOR)).filter(
		(scope) => scope.checkVisibility(),
	);
	const focused = document.activeElement;
	const focusedScope = focused ? scopes.find((scope) => scope.contains(focused)) : undefined;
	if (focusedScope) return focusedScope;
	if (document.querySelector("[data-pane-active]")) {
		return scopes.find((scope) => scope.closest('[data-pane-active="true"]')) ?? null;
	}
	return scopes.length === 1 ? (scopes[0] ?? null) : null;
}

/** The compact counter ("2/5") and its screen-reader phrasing ("Match 2 of 5"). */
function describeMatches({
	query,
	total,
	activeIndex,
}: Pick<DomFindController, "query" | "total" | "activeIndex">): {
	shown: string;
	spoken: string;
} {
	if (total > 0) {
		const position = String(activeIndex + 1);
		return {
			shown: `${position}/${String(total)}`,
			spoken: `Match ${position} of ${String(total)}`,
		};
	}
	return query ? { shown: "0/0", spoken: "No matches" } : { shown: "", spoken: "" };
}

export interface FindBarProps {
	/** The pane's find scope element; it must carry `data-find-scope` (see `FindScope`). */
	readonly rootRef: RefObject<HTMLElement | null>;
	/** CSS selector (relative to root) for the searchable subtree; defaults to the root. */
	readonly searchRootSelector?: string;
	/** Prefix for `data-qa-id`s, e.g. `chat-find` → `chat-find-bar`, `chat-find-input`. */
	readonly qaPrefix: string;
	readonly placeholder?: string;
	/** Extra classes for the bar container, e.g. to offset its position below a pane header. */
	readonly className?: string;
	readonly onOpenChange?: (open: boolean) => void;
}

const FindScopeOpenContext = createContext(false);

/**
 * Whether the enclosing find scope's bar is open. Content that renders only
 * part of itself (a windowed list) renders all of it while open: find
 * searches the DOM.
 */
export const useFindScopeOpen = () => useContext(FindScopeOpenContext);

/**
 * Shared per-pane find bar for DOM content. Mounted once inside a pane's find
 * scope; opens on the platform find chord when focus is within this pane (or,
 * when nothing in a find scope is focused, in the active/sole scope) and
 * highlights matches with the CSS Custom Highlight API.
 *
 * It never calls `preventDefault` unless it opens, so panes that run their own
 * native search (e.g. a code editor outside any find scope) still receive the
 * chord.
 */
export function FindBar({
	rootRef,
	searchRootSelector,
	qaPrefix,
	placeholder,
	className,
	onOpenChange,
}: FindBarProps) {
	const find = useDomFind({ rootRef, ...(searchRootSelector ? { searchRootSelector } : {}) });
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;
	useEffect(() => onOpenChangeRef.current?.(find.open), [find.open]);
	const { openBar } = find;
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isFindChord(event)) return;
			const root = rootRef.current;
			if (!root || chordTarget() !== root) return;
			event.preventDefault();
			openBar();
			// Already open: pressing the chord again returns focus to the query,
			// ready to retype. A first open focuses it once the input mounts.
			inputRef.current?.focus();
			inputRef.current?.select();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [openBar, rootRef]);

	useEffect(() => {
		if (!find.open) return;
		const input = inputRef.current;
		input?.focus();
		input?.select();
	}, [find.open]);

	if (!find.open) return null;

	const counter = describeMatches(find);

	return (
		<div
			className={cn(
				"border-border bg-popover text-popover-foreground absolute top-3 right-3 z-30 flex items-center gap-1 rounded-md border p-1 shadow-md",
				className,
			)}
			data-qa-id={`${qaPrefix}-bar`}
			data-find-ignore
			role="search"
		>
			<Input
				ref={inputRef}
				value={find.query}
				onChange={(event) => find.setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						find.closeBar();
					} else if (event.key === "Enter") {
						event.preventDefault();
						if (event.shiftKey) find.prev();
						else find.next();
					}
				}}
				placeholder={placeholder ?? "Find"}
				aria-label={placeholder ?? "Find"}
				className="h-7 w-48"
				data-qa-id={`${qaPrefix}-input`}
			/>
			<span
				className="text-muted-foreground min-w-10 px-1 text-center text-xs tabular-nums"
				data-qa-id={`${qaPrefix}-count`}
				aria-hidden="true"
			>
				{counter.shown}
			</span>
			<span role="status" className="sr-only">
				{counter.spoken}
			</span>
			<Toggle
				size="sm"
				pressed={find.caseSensitive}
				onPressedChange={find.toggleCaseSensitive}
				aria-label="Match case"
				data-qa-id={`${qaPrefix}-case`}
			>
				Aa
			</Toggle>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={find.prev}
				disabled={find.total === 0}
				aria-label="Previous match"
				data-qa-id={`${qaPrefix}-prev`}
			>
				<ChevronUpIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={find.next}
				disabled={find.total === 0}
				aria-label="Next match"
				data-qa-id={`${qaPrefix}-next`}
			>
				<ChevronDownIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={find.closeBar}
				aria-label="Close find"
				data-qa-id={`${qaPrefix}-close`}
			>
				<XIcon />
			</Button>
		</div>
	);
}

export interface FindScopeProps
	extends Omit<ComponentProps<"div">, "ref">, Omit<FindBarProps, "rootRef" | "className"> {
	/** Extra classes for the floating bar, e.g. `top-14` to clear a pane header. */
	readonly barClassName?: string;
}

/**
 * A pane's find scope: a positioned container that owns a `FindBar` for its
 * content. This is the way to add find to a pane; `FindBar` alone is for
 * callers that already own the scope element.
 */
export function FindScope({
	searchRootSelector,
	qaPrefix,
	placeholder,
	barClassName,
	className,
	children,
	...props
}: FindScopeProps) {
	const scopeRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<div {...props} ref={scopeRef} data-find-scope className={cn("relative", className)}>
			<FindBar
				rootRef={scopeRef}
				qaPrefix={qaPrefix}
				{...(searchRootSelector ? { searchRootSelector } : {})}
				{...(placeholder ? { placeholder } : {})}
				{...(barClassName ? { className: barClassName } : {})}
				onOpenChange={setOpen}
			/>
			<FindScopeOpenContext.Provider value={open}>{children}</FindScopeOpenContext.Provider>
		</div>
	);
}
