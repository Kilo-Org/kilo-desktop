"use client";

import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	createContext,
	useContext,
	type ComponentProps,
	type ComponentPropsWithoutRef,
	type ReactNode,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useAui } from "@assistant-ui/react";

import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@anaconda-agentic-desktop/ui/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@anaconda-agentic-desktop/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

export type ModelSelectorEffortOption = {
	id: string;
	name: string;
};

export const DEFAULT_EFFORT_OPTIONS: readonly ModelSelectorEffortOption[] = [
	{ id: "low", name: "Low" },
	{ id: "medium", name: "Med" },
	{ id: "high", name: "High" },
];

export type ModelOption = {
	id: string;
	name: string;
	description?: string;
	icon?: ReactNode;
	disabled?: boolean;
	/** Extra terms matched by ModelSelector.Search, in addition to id and name. */
	keywords?: readonly string[];
	/**
	 * Reasoning effort levels the model supports. Pass `true` for the default
	 * low/medium/high levels, or a custom list. Omit for models without
	 * configurable reasoning.
	 */
	efforts?: boolean | readonly ModelSelectorEffortOption[];
};

export function getModelEfforts(
	model: ModelOption | undefined,
): readonly ModelSelectorEffortOption[] | undefined {
	if (!model?.efforts) return undefined;
	return model.efforts === true ? DEFAULT_EFFORT_OPTIONS : model.efforts;
}

function resolveEffort(
	efforts: readonly ModelSelectorEffortOption[] | undefined,
	effort: string | undefined,
): string | undefined {
	if (!efforts?.length) return undefined;
	if (effort !== undefined && efforts.some((e) => e.id === effort)) {
		return effort;
	}
	// No per-model default from the provider — prefer medium when present, else first.
	return efforts.find((option) => option.id === "medium")?.id ?? efforts[0]?.id;
}

/**
 * Returns the effort id that applies to the given model.
 * Effort selection is sticky across model switches when still supported; otherwise
 * falls back to medium (if available) or the model's first effort level. Models
 * without configurable reasoning return undefined.
 */
export function resolveModelEffort(
	models: readonly ModelOption[],
	modelId: string | undefined,
	effort: string | undefined,
): string | undefined {
	return resolveEffort(getModelEfforts(models.find((m) => m.id === modelId)), effort);
}

function useControllableState<T>({
	prop,
	defaultProp,
	onChange,
}: {
	prop: T | undefined;
	defaultProp: T | undefined;
	onChange: ((next: T) => void) | undefined;
}) {
	const [internal, setInternal] = useState(defaultProp);
	const isControlled = prop !== undefined;
	const value = isControlled ? prop : internal;
	// Read onChange through a ref so inline callbacks don't recreate the setter
	// (and with it the memoized context value) every render.
	const onChangeRef = useRef(onChange);
	useEffect(() => {
		onChangeRef.current = onChange;
	});
	const setValue = useCallback(
		(next: T) => {
			if (!isControlled) setInternal(next);
			onChangeRef.current?.(next);
		},
		[isControlled],
	);
	return [value, setValue] as const;
}

type ModelSelectorContextValue = {
	models: readonly ModelOption[];
	value: string | undefined;
	setValue: (value: string) => void;
	/** The model matching `value`, derived once for all sub-components. */
	selectedModel: ModelOption | undefined;
	/** The selected model's effort levels, undefined when not configurable. */
	efforts: readonly ModelSelectorEffortOption[] | undefined;
	/** Effort resolved against the selected model's supported levels. */
	effort: string | undefined;
	setEffort: (effort: string) => void;
	setOpen: (open: boolean) => void;
};

const ModelSelectorContext = createContext<ModelSelectorContextValue | null>(null);

export function useModelSelectorContext() {
	const ctx = useContext(ModelSelectorContext);
	if (!ctx) {
		throw new Error("ModelSelector sub-components must be used within ModelSelector.Root");
	}
	return ctx;
}

/**
 * The selected model's effort levels and the active selection. Use it to build
 * a custom effort UI inside ModelSelector.Content when the built-in
 * ModelSelector.Effort layout doesn't fit. `efforts` is undefined for models
 * without configurable reasoning.
 */
export function useModelSelectorEfforts(): {
	efforts: readonly ModelSelectorEffortOption[] | undefined;
	effort: string | undefined;
	setEffort: (effort: string) => void;
} {
	const { efforts, effort, setEffort } = useModelSelectorContext();
	return { efforts, effort, setEffort };
}

export type ModelSelectorRootProps = {
	models: readonly ModelOption[];
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	effort?: string;
	defaultEffort?: string;
	onEffortChange?: (effort: string) => void;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
};

function ModelSelectorRoot({
	models,
	value: valueProp,
	defaultValue,
	onValueChange,
	effort: effortProp,
	defaultEffort,
	onEffortChange,
	open: openProp,
	defaultOpen,
	onOpenChange,
	children,
}: ModelSelectorRootProps) {
	const [value, setValue] = useControllableState({
		prop: valueProp,
		defaultProp: defaultValue ?? models[0]?.id,
		onChange: onValueChange,
	});
	const [effort, setEffort] = useControllableState({
		prop: effortProp,
		defaultProp: defaultEffort,
		onChange: onEffortChange,
	});
	const [open, setOpen] = useControllableState({
		prop: openProp,
		defaultProp: defaultOpen ?? false,
		onChange: onOpenChange,
	});

	const selectedModel = models.find((m) => m.id === value);
	const efforts = getModelEfforts(selectedModel);
	const activeEffort = resolveEffort(efforts, effort);
	const contextValue = useMemo(
		() => ({
			models,
			value,
			setValue,
			selectedModel,
			efforts,
			effort: activeEffort,
			setEffort,
			setOpen,
		}),
		[models, value, setValue, selectedModel, efforts, activeEffort, setEffort, setOpen],
	);

	return (
		<ModelSelectorContext.Provider value={contextValue}>
			<Popover open={open ?? false} onOpenChange={setOpen}>
				{children}
			</Popover>
		</ModelSelectorContext.Provider>
	);
}

export const modelSelectorTriggerVariants = cva(
	"focus-visible:ring-ring/50 flex w-fit items-center justify-between gap-2 overflow-hidden rounded-md text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				outline:
					"border-input border bg-transparent hover:bg-foreground/5 hover:text-foreground aria-expanded:bg-foreground/5 aria-expanded:text-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground",
				ghost:
					"hover:bg-foreground/5 hover:text-foreground aria-expanded:bg-foreground/5 aria-expanded:text-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground",
				muted:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground data-popup-open:bg-secondary data-popup-open:text-secondary-foreground",
			},
			size: {
				default: "h-9 px-3 py-2",
				sm: "h-8 px-2.5 py-1.5 text-xs",
				lg: "h-10 px-4 py-2.5",
			},
		},
		defaultVariants: {
			variant: "outline",
			size: "default",
		},
	},
);

export type ModelSelectorTriggerProps = ComponentPropsWithoutRef<typeof PopoverTrigger> &
	VariantProps<typeof modelSelectorTriggerVariants>;

function ModelSelectorTrigger({
	className,
	variant,
	size,
	children,
	onKeyDown,
	...props
}: ModelSelectorTriggerProps) {
	const { setOpen } = useModelSelectorContext();

	return (
		<PopoverTrigger
			data-slot="model-selector-trigger"
			data-variant={variant ?? "outline"}
			data-size={size ?? "default"}
			role="combobox"
			aria-haspopup="listbox"
			className={cn(modelSelectorTriggerVariants({ variant, size }), className)}
			onKeyDown={(e) => {
				onKeyDown?.(e);
				if (e.defaultPrevented) return;
				// ARIA combobox: arrows open the listbox from a focused trigger.
				// Popover leaves this to the consumer.
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					setOpen(true);
				}
			}}
			{...props}
		>
			{children ?? <ModelSelectorValue />}
			<ChevronDownIcon className="size-4 opacity-50" />
		</PopoverTrigger>
	);
}

export type ModelSelectorValueProps = {
	placeholder?: ReactNode;
	/** Show the active effort level next to the model name. */
	showEffort?: boolean;
	className?: string;
};

function ModelIcon({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				"flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5",
				className,
			)}
		>
			{children}
		</span>
	);
}

function ModelSelectorValue({
	placeholder = "Select model",
	showEffort = true,
	className,
}: ModelSelectorValueProps) {
	const { selectedModel, efforts, effort } = useModelSelectorContext();

	if (!selectedModel) {
		return (
			<span data-slot="model-selector-value" className={cn("text-muted-foreground", className)}>
				{placeholder}
			</span>
		);
	}

	const effortName =
		showEffort && effort !== undefined ? efforts?.find((e) => e.id === effort)?.name : undefined;

	return (
		<span data-slot="model-selector-value" className={cn("flex items-center gap-2", className)}>
			{selectedModel.icon && <ModelIcon>{selectedModel.icon}</ModelIcon>}
			<span className="font-medium whitespace-nowrap">{selectedModel.name}</span>
			{effortName && (
				<span className="text-muted-foreground min-w-7.5 shrink-0 text-center">{effortName}</span>
			)}
		</span>
	);
}

export type ModelSelectorContentProps = Omit<
	ComponentPropsWithoutRef<typeof PopoverContent>,
	"side"
> & {
	/**
	 * Preferred side for the initial placement. Once the popover is open, the
	 * rendered side takes over until it closes, so the popup does not jump
	 * between sides while filtering resizes the list.
	 */
	side?: ComponentPropsWithoutRef<typeof PopoverContent>["side"];
	searchable?: boolean;
	/**
	 * Override cmdk filtering. Set `false` when the consumer filters (and
	 * optionally virtualizes) the list themselves.
	 */
	shouldFilter?: boolean;
	/** Controlled cmdk highlight value (keyboard / pointer). */
	commandValue?: string;
	/** Fires when the cmdk highlighted item changes (keyboard / hover). */
	onCommandValueChange?: (value: string) => void;
	/** Key handler on the cmdk root (e.g. full-list virtualized navigation). */
	onCommandKeyDown?: ComponentPropsWithoutRef<typeof Command>["onKeyDown"];
};

// Base UI's Popover re-evaluates collision flipping whenever the popup
// resizes, so filtering the list down flips the popup back to the preferred
// side mid-interaction. Base UI only exposes its lazy-flip behavior on the
// Combobox positioner, so mirror it here: feed the rendered side back as the
// preferred side, making the popup keep its side until it no longer fits.
function useLazyFlipSide(): {
	side: ModelSelectorContentProps["side"];
	popupRef: (node: HTMLDivElement | null) => void;
} {
	const [side, setSide] = useState<ModelSelectorContentProps["side"]>();
	const observerRef = useRef<MutationObserver | null>(null);
	const popupRef = useCallback((node: HTMLDivElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		if (!node) {
			setSide(undefined);
			return;
		}
		const sync = () => {
			const rendered = node.getAttribute("data-side");
			if (rendered) setSide(rendered as ModelSelectorContentProps["side"]);
		};
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(node, {
			attributes: true,
			attributeFilter: ["data-side"],
		});
		observerRef.current = observer;
	}, []);
	return { side, popupRef };
}

/**
 * Hidden input that anchors cmdk's keyboard navigation, keeping the list
 * keyboard-operable without a visible search box. ModelSelectorContent renders
 * one automatically when unfiltered.
 */
function ModelSelectorFocusAnchor() {
	return (
		<div className="sr-only">
			<CommandInput readOnly aria-label="Model" />
		</div>
	);
}

function ModelSelectorContent({
	className,
	align = "start",
	side,
	sideOffset = 6,
	searchable,
	shouldFilter: shouldFilterProp,
	commandValue,
	onCommandValueChange,
	onCommandKeyDown,
	children,
	initialFocus,
	...props
}: ModelSelectorContentProps) {
	const { value } = useModelSelectorContext();
	const { side: renderedSide, popupRef } = useLazyFlipSide();
	const contentNodeRef = useRef<HTMLDivElement | null>(null);
	const unfiltered = searchable === false || (!searchable && children === undefined);
	const shouldFilter = shouldFilterProp ?? !unfiltered;

	const setContentRef = useCallback(
		(node: HTMLDivElement | null) => {
			contentNodeRef.current = node;
			popupRef(node);
		},
		[popupRef],
	);

	// Prefer the cmdk input so ↑/↓ navigate the model list. Without this, Base UI
	// focuses the first tabbable (often a provider-rail button) and list keys never fire.
	const focusSearchInput = useCallback((openType: string) => {
		if (openType === "touch") {
			return true;
		}
		return contentNodeRef.current?.querySelector<HTMLElement>("[cmdk-input]") ?? true;
	}, []);

	return (
		<PopoverContent
			ref={setContentRef}
			data-slot="model-selector-content"
			align={align}
			side={renderedSide ?? side ?? "bottom"}
			sideOffset={sideOffset}
			initialFocus={initialFocus ?? focusSearchInput}
			className={cn(
				"bg-popover/95 w-72 min-w-(--anchor-width) overflow-hidden rounded-xl p-0 shadow-lg backdrop-blur-sm",
				className,
			)}
			{...props}
		>
			<Command
				className="bg-transparent"
				shouldFilter={shouldFilter}
				{...(commandValue !== undefined ? { value: commandValue } : {})}
				{...(onCommandValueChange ? { onValueChange: onCommandValueChange } : {})}
				{...(onCommandKeyDown ? { onKeyDown: onCommandKeyDown } : {})}
				{...(commandValue === undefined && value !== undefined ? { defaultValue: value } : {})}
			>
				{unfiltered && <ModelSelectorFocusAnchor />}
				{children ?? (
					<>
						{searchable && <ModelSelectorSearch />}
						<ModelSelectorList />
						<ModelSelectorEffort />
					</>
				)}
			</Command>
		</PopoverContent>
	);
}

export type ModelSelectorSearchProps = ComponentPropsWithoutRef<typeof CommandInput>;

function ModelSelectorSearch({
	placeholder = "Search models...",
	...props
}: ModelSelectorSearchProps) {
	return <CommandInput data-slot="model-selector-search" placeholder={placeholder} {...props} />;
}

export type ModelSelectorListProps = ComponentProps<typeof CommandList>;

function ModelSelectorList({ className, children, ref, ...props }: ModelSelectorListProps) {
	const { models } = useModelSelectorContext();

	return (
		<CommandList
			ref={ref}
			data-slot="model-selector-list"
			className={cn(
				"[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
				className,
			)}
			{...props}
		>
			{children ?? (
				<>
					<ModelSelectorEmpty />
					<CommandGroup>
						{models.map((model) => (
							<ModelSelectorItem key={model.id} model={model} />
						))}
					</CommandGroup>
				</>
			)}
		</CommandList>
	);
}

export type ModelSelectorEmptyProps = ComponentPropsWithoutRef<typeof CommandEmpty>;

function ModelSelectorEmpty({ children, ...props }: ModelSelectorEmptyProps) {
	return (
		<CommandEmpty data-slot="model-selector-empty" {...props}>
			{children ?? "No models found."}
		</CommandEmpty>
	);
}

export type ModelSelectorGroupProps = ComponentPropsWithoutRef<typeof CommandGroup>;

function ModelSelectorGroup(props: ModelSelectorGroupProps) {
	return <CommandGroup data-slot="model-selector-group" {...props} />;
}

export type ModelSelectorSeparatorProps = ComponentPropsWithoutRef<typeof CommandSeparator>;

function ModelSelectorSeparator(props: ModelSelectorSeparatorProps) {
	return <CommandSeparator data-slot="model-selector-separator" {...props} />;
}

export type ModelSelectorItemProps = Omit<ComponentPropsWithoutRef<typeof CommandItem>, "value"> & {
	model: ModelOption;
};

function ModelSelectorItem({
	model,
	className,
	children,
	onSelect,
	...props
}: ModelSelectorItemProps) {
	const { value, setValue, setOpen } = useModelSelectorContext();
	const isSelected = value === model.id;

	return (
		<CommandItem
			data-slot="model-selector-item"
			value={model.id}
			keywords={[model.name, ...(model.keywords ?? [])]}
			{...(model.disabled ? { disabled: true } : undefined)}
			onSelect={(selectedValue) => {
				setValue(model.id);
				setOpen(false);
				onSelect?.(selectedValue);
			}}
			className={cn(
				"relative items-start gap-2 rounded-lg py-2 ps-3 pe-9 [&_svg:not([class*='size-'])]:size-3.5",
				className,
			)}
			{...props}
		>
			{children ?? (
				<>
					{model.icon && <ModelIcon className="mt-[3px]">{model.icon}</ModelIcon>}
					<span className="flex min-w-0 flex-col">
						<span className="truncate font-medium">{model.name}</span>
						{model.description && (
							<span className="text-muted-foreground truncate text-xs">{model.description}</span>
						)}
					</span>
				</>
			)}
			{isSelected && (
				<span className="absolute end-3 top-2.5 flex size-4 items-center justify-center">
					<CheckIcon className="size-4" />
				</span>
			)}
		</CommandItem>
	);
}

export type ModelSelectorEffortProps = ComponentPropsWithoutRef<"div"> & {
	label?: ReactNode;
};

function ModelSelectorEffort({
	label = "Effort",
	className,
	onKeyDown,
	...props
}: ModelSelectorEffortProps) {
	const { efforts, effort, setEffort } = useModelSelectorEfforts();

	if (!efforts?.length) return null;

	const ariaLabel = typeof label === "string" ? label : "Reasoning effort";
	const items = efforts.map((option) => ({
		label: option.name,
		value: option.id,
	}));

	return (
		<div
			data-slot="model-selector-effort"
			className={cn(
				"flex cursor-default items-center justify-between gap-3 border-t px-3 py-2",
				className,
			)}
			onKeyDown={(e) => {
				onKeyDown?.(e);
				if (e.defaultPrevented) return;
				// Keep ↑/↓/Home/End on the select; stop them from jumping the cmdk
				// model list while the effort control is focused.
				if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") {
					e.stopPropagation();
				}
			}}
			{...props}
		>
			<span className="text-muted-foreground text-xs">{label}</span>
			<Select
				items={items}
				value={effort ?? items[0]?.value}
				modal={false}
				onValueChange={(next) => {
					if (next != null) {
						setEffort(next);
					}
				}}
			>
				<SelectTrigger
					size="sm"
					aria-label={ariaLabel}
					data-qa-id="model-selector-effort-select"
					className="min-w-24"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={false} align="end" side="top">
					<SelectGroup>
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}

export type ModelSelectorProps = Omit<ModelSelectorRootProps, "children"> &
	VariantProps<typeof modelSelectorTriggerVariants> & {
		/** Render a search input above the model list. */
		searchable?: boolean;
		/** Alignment of the dropdown relative to the trigger. Use `"end"` when the
		 * trigger sits at the right edge of its container. */
		align?: ModelSelectorContentProps["align"];
		className?: string;
		contentClassName?: string;
	};

/** Registers the selection with assistant-ui's ModelContext system. The
 * context's effort is already resolved against the selected model. */
function ModelSelectorModelContext() {
	const { value, effort } = useModelSelectorContext();
	const api = useAui();

	useEffect(() => {
		if (value === undefined) return;
		const config = {
			config: {
				modelName: value,
				...(effort !== undefined ? { reasoningEffort: effort } : undefined),
			},
		};
		return api.modelContext.register({
			getModelContext: () => config,
		});
	}, [api, value, effort]);

	return null;
}

const ModelSelectorImpl = ({
	searchable,
	variant,
	size,
	align,
	className,
	contentClassName,
	...rootProps
}: ModelSelectorProps) => {
	return (
		<ModelSelectorRoot {...rootProps}>
			<ModelSelectorModelContext />
			<ModelSelectorTrigger variant={variant} size={size} className={className} />
			<ModelSelectorContent
				{...(align !== undefined ? { align } : {})}
				className={contentClassName}
				searchable={searchable ?? false}
			/>
		</ModelSelectorRoot>
	);
};

type ModelSelectorComponent = typeof ModelSelectorImpl & {
	displayName?: string;
	Root: typeof ModelSelectorRoot;
	Trigger: typeof ModelSelectorTrigger;
	Value: typeof ModelSelectorValue;
	Content: typeof ModelSelectorContent;
	Search: typeof ModelSelectorSearch;
	FocusAnchor: typeof ModelSelectorFocusAnchor;
	List: typeof ModelSelectorList;
	Empty: typeof ModelSelectorEmpty;
	Group: typeof ModelSelectorGroup;
	Separator: typeof ModelSelectorSeparator;
	Item: typeof ModelSelectorItem;
	Effort: typeof ModelSelectorEffort;
};

const ModelSelector = memo(ModelSelectorImpl) as unknown as ModelSelectorComponent;

ModelSelector.displayName = "ModelSelector";
ModelSelector.Root = ModelSelectorRoot;
ModelSelector.Trigger = ModelSelectorTrigger;
ModelSelector.Value = ModelSelectorValue;
ModelSelector.Content = ModelSelectorContent;
ModelSelector.Search = ModelSelectorSearch;
ModelSelector.FocusAnchor = ModelSelectorFocusAnchor;
ModelSelector.List = ModelSelectorList;
ModelSelector.Empty = ModelSelectorEmpty;
ModelSelector.Group = ModelSelectorGroup;
ModelSelector.Separator = ModelSelectorSeparator;
ModelSelector.Item = ModelSelectorItem;
ModelSelector.Effort = ModelSelectorEffort;

export {
	ModelSelector,
	ModelSelectorRoot,
	ModelSelectorTrigger,
	ModelSelectorValue,
	ModelSelectorContent,
	ModelSelectorSearch,
	ModelSelectorFocusAnchor,
	ModelSelectorList,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorSeparator,
	ModelSelectorItem,
	ModelSelectorEffort,
};
