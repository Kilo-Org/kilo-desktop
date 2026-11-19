"use client";

import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type ComponentType,
	type FC,
	type ReactNode,
} from "react";
import {
	ComposerPrimitive,
	unstable_defaultDirectiveFormatter,
	// React Compiler only treats `use*` names as hooks; an `unstable_` prefix would be memoized like a plain call.
	unstable_useTriggerPopoverScopeContext as useTriggerPopoverScopeContext,
	type Unstable_DirectiveFormatter,
	type Unstable_TriggerItem,
} from "@assistant-ui/react";
import { ChevronLeftIcon, ChevronRightIcon, SparklesIcon } from "lucide-react";
import { menuRow, menuSeparator } from "@kilo-desktop/ui/lib/menu-styles";
import { cn } from "@kilo-desktop/ui/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

type DirectiveBehaviorProps = {
	/** Formatter used to serialize the selected item into composer text. */
	formatter?: Unstable_DirectiveFormatter | undefined;
	/** Called after the directive text has been inserted into the composer. */
	onInserted?: ((item: Unstable_TriggerItem) => void) | undefined;
};

type ActionBehaviorProps = {
	/** Formatter used to serialize the audit-trail chip (when `removeOnExecute` is false). */
	formatter?: Unstable_DirectiveFormatter | undefined;
	/** Invoked with the selected item at the moment of selection. */
	onExecute: (item: Unstable_TriggerItem) => void;
	/** If `true`, strip the trigger text from the composer after executing. @default false */
	removeOnExecute?: boolean | undefined;
};

type ComposerTriggerPopoverBaseProps = Omit<
	ComponentPropsWithoutRef<typeof ComposerPrimitive.Unstable_TriggerPopover>,
	"children"
> & {
	/**
	 * Maps icon keys to components. Items look up via `item.metadata?.icon`
	 * (string); categories look up via their `id`.
	 */
	iconMap?: Record<string, IconComponent>;
	/** Fallback icon when no entry in `iconMap` matches. */
	fallbackIcon?: IconComponent;
	/** Renders an item-specific icon before falling back to `iconMap`. */
	renderItemIcon?: ((item: Unstable_TriggerItem) => ReactNode) | undefined;
	/** Label shown on the back button. @default "Back" */
	backLabel?: string;
	/** Label shown when no categories are available. @default "No items available" */
	emptyCategoriesLabel?: string;
	/** Label shown when no items match. @default "No matching items" */
	emptyItemsLabel?: string;
	/** Label shown while an async adapter is resolving items. @default "Loading…" */
	loadingLabel?: string;
};

type ComposerTriggerPopoverProps = ComposerTriggerPopoverBaseProps &
	(
		| {
				/** Insert-directive behavior. */
				directive: DirectiveBehaviorProps;
				action?: never;
		  }
		| {
				/** Action behavior. */
				action: ActionBehaviorProps;
				directive?: never;
		  }
	);

/**
 * Where a composer's `/` and mention menus open. The thread's composer sits at
 * the bottom of the pane, so its menus always open above; a composer inside
 * the transcript (editing a sent prompt) picks the side with room.
 */
export type TriggerPopoverPlacement = "above" | "auto";

const TriggerPopoverPlacementContext = createContext<TriggerPopoverPlacement>("above");

export const TriggerPopoverPlacementProvider = TriggerPopoverPlacementContext.Provider;

function scrollClip(element: HTMLElement): { top: number; bottom: number } {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") {
			const rect = node.getBoundingClientRect();
			return { top: rect.top, bottom: rect.bottom };
		}
	}
	return { top: 0, bottom: window.innerHeight };
}

/**
 * Opens below when the menu doesn't fit above its composer but has more room
 * below. Measured as the menu attaches, before the browser paints it.
 */
function useOpensBelow(placement: TriggerPopoverPlacement) {
	const [below, setBelow] = useState(false);
	const measure = (element: HTMLDivElement | null) => {
		if (placement !== "auto" || !element?.offsetParent) return;
		const anchor = element.offsetParent.getBoundingClientRect();
		const clip = scrollClip(element);
		const spaceAbove = anchor.top - clip.top;
		const spaceBelow = clip.bottom - anchor.bottom;
		setBelow(spaceAbove < element.offsetHeight && spaceBelow > spaceAbove);
	};
	return [placement === "auto" && below, measure] as const;
}

function resolveIcon(
	iconKey: string | undefined,
	iconMap: Record<string, IconComponent> | undefined,
	fallback: IconComponent,
): IconComponent {
	if (iconKey && iconMap?.[iconKey]) return iconMap[iconKey]!;
	return fallback;
}

const MENU_ITEM = cn(
	menuRow,
	"w-full cursor-pointer hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent",
);

const MENU_EMPTY = "text-muted-foreground px-2 py-1.5 text-sm";

type CategoriesProps = {
	iconMap: Record<string, IconComponent> | undefined;
	fallbackIcon: IconComponent;
	emptyLabel: string;
};

const Categories: FC<CategoriesProps> = ({ iconMap, fallbackIcon, emptyLabel }) => (
	<ComposerPrimitive.Unstable_TriggerPopoverCategories>
		{(categories) => (
			<div data-slot="composer-trigger-popover-categories" className="flex flex-col">
				{categories.map((cat) => {
					const Icon = resolveIcon(cat.id, iconMap, fallbackIcon);
					return (
						<ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
							key={cat.id}
							categoryId={cat.id}
							className={cn(MENU_ITEM, "justify-between")}
						>
							<span className="flex min-w-0 items-center gap-2">
								<Icon className="size-3.5" />
								{cat.label}
							</span>
							<ChevronRightIcon className="size-3.5" />
						</ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
					);
				})}
				{categories.length === 0 && <div className={MENU_EMPTY}>{emptyLabel}</div>}
			</div>
		)}
	</ComposerPrimitive.Unstable_TriggerPopoverCategories>
);

type ItemsProps = {
	iconMap: Record<string, IconComponent> | undefined;
	fallbackIcon: IconComponent;
	renderItemIcon: ((item: Unstable_TriggerItem) => ReactNode) | undefined;
	backLabel: string;
	emptyLabel: string;
	loadingLabel: string;
};

const Items: FC<ItemsProps> = ({
	iconMap,
	fallbackIcon,
	renderItemIcon,
	backLabel,
	emptyLabel,
	loadingLabel,
}) => {
	const { isLoading, activeCategoryId, isSearchMode, highlightedItemId } =
		useTriggerPopoverScopeContext();
	const itemsRef = useRef<HTMLDivElement>(null);
	const showBack = Boolean(activeCategoryId) && !isSearchMode;
	useEffect(() => {
		if (!highlightedItemId) return;
		itemsRef.current
			?.querySelector(`[role=option]#${CSS.escape(highlightedItemId)}`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [highlightedItemId]);
	return (
		<ComposerPrimitive.Unstable_TriggerPopoverItems ref={itemsRef}>
			{(items) => (
				<div data-slot="composer-trigger-popover-items" className="flex flex-col">
					<ComposerPrimitive.Unstable_TriggerPopoverBack
						className={cn(MENU_ITEM, "text-muted-foreground")}
					>
						<ChevronLeftIcon className="size-3.5" />
						{backLabel}
					</ComposerPrimitive.Unstable_TriggerPopoverBack>
					{showBack ? <div className={menuSeparator} /> : null}

					{items.map((item, index) => {
						const iconKey =
							typeof item.metadata?.icon === "string" ? item.metadata.icon : undefined;
						const Icon = resolveIcon(iconKey, iconMap, fallbackIcon);
						const itemIcon = renderItemIcon?.(item);
						return (
							<ComposerPrimitive.Unstable_TriggerPopoverItem
								key={item.id}
								item={item}
								index={index}
								className={cn(MENU_ITEM, "text-start")}
							>
								{itemIcon ?? <Icon className="size-3.5 shrink-0" />}
								<span className="shrink-0 font-medium">{item.label}</span>
								{item.description ? (
									<span className="text-muted-foreground min-w-0 truncate text-xs">
										{item.description}
									</span>
								) : null}
							</ComposerPrimitive.Unstable_TriggerPopoverItem>
						);
					})}
					{items.length === 0 && (
						<div className={MENU_EMPTY}>{isLoading ? loadingLabel : emptyLabel}</div>
					)}
				</div>
			)}
		</ComposerPrimitive.Unstable_TriggerPopoverItems>
	);
};

/**
 * Pre-built popover UI for a trigger-driven picker (mentions, slash commands, etc).
 * Pass exactly one of `directive` (inserts a chip) or `action` (fires a handler).
 */
export const ComposerTriggerPopover: FC<ComposerTriggerPopoverProps> = ({
	iconMap,
	fallbackIcon = SparklesIcon,
	renderItemIcon,
	backLabel = "Back",
	emptyCategoriesLabel = "No items available",
	emptyItemsLabel = "No matching items",
	loadingLabel = "Loading…",
	className,
	directive,
	action,
	...props
}) => {
	const warnedRef = useRef(false);
	const [opensBelow, measurePlacement] = useOpensBelow(useContext(TriggerPopoverPlacementContext));
	const misconfigured = Boolean(directive) === Boolean(action);
	useEffect(() => {
		if (process.env.NODE_ENV === "production" || warnedRef.current || !misconfigured) return;
		warnedRef.current = true;
		console.warn(
			"[assistant-ui] ComposerTriggerPopover requires exactly one of `directive` or `action` props.",
		);
	}, [misconfigured]);

	return (
		<ComposerPrimitive.Unstable_TriggerPopover
			data-slot="composer-trigger-popover"
			data-side={opensBelow ? "bottom" : "top"}
			className={cn(
				"aui-composer-trigger-popover bg-popover/95 text-popover-foreground absolute start-0 z-50 flex w-full max-h-[min(20rem,calc(100dvh-14rem))] flex-col overflow-hidden rounded-lg shadow-md ring-1 ring-foreground/10 backdrop-blur-sm",
				opensBelow ? "top-full mt-2" : "bottom-full mb-2",
				className,
			)}
			{...props}
			ref={measurePlacement}
		>
			{directive ? (
				<ComposerPrimitive.Unstable_TriggerPopover.Directive
					formatter={directive.formatter ?? unstable_defaultDirectiveFormatter}
					onInserted={directive.onInserted}
				/>
			) : action ? (
				<ComposerPrimitive.Unstable_TriggerPopover.Action
					formatter={action.formatter ?? unstable_defaultDirectiveFormatter}
					onExecute={action.onExecute}
					removeOnExecute={action.removeOnExecute}
				/>
			) : null}
			{/* The fade lives on an inner scroller: a mask on the popover itself would clip its ring and shadow.
			    Closed triggers render children bare inside the composer shell, so the empty scroller must collapse. */}
			<div className="scroll-fade-y min-h-0 overflow-x-hidden overflow-y-auto p-1 empty:hidden">
				<Categories
					iconMap={iconMap}
					fallbackIcon={fallbackIcon}
					emptyLabel={emptyCategoriesLabel}
				/>
				<Items
					iconMap={iconMap}
					fallbackIcon={fallbackIcon}
					renderItemIcon={renderItemIcon}
					backLabel={backLabel}
					emptyLabel={emptyItemsLabel}
					loadingLabel={loadingLabel}
				/>
			</div>
		</ComposerPrimitive.Unstable_TriggerPopover>
	);
};
