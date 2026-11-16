import type {
	ComposerPrimitive,
	Unstable_DirectiveFormatter,
	Unstable_TriggerItem,
} from "@assistant-ui/react";
import { AtSignIcon } from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type FC,
} from "react";

import { useExtensions } from "@kilo-desktop/kernel/web";

import {
	ComposerMention,
	type ComposerContext,
	type IconComponent,
	type MentionItem,
} from "../../contracts";
import { mentionType, type MentionSource } from "./mention-codec";
import { ComposerTriggerPopover } from "./trigger-popover";

/** The window's mention sources: `composer-mention` contributions bound here. */
export function useMentionSources(): readonly MentionSource[] {
	const contributions = useExtensions(ComposerMention);
	return useMemo(
		() =>
			contributions.flatMap((contribution) =>
				contribution.implementation
					? [
							{
								key: contribution.key,
								trigger: contribution.metadata.trigger,
								title: contribution.metadata.title,
								implementation: contribution.implementation,
							},
						]
					: [],
			),
		[contributions],
	);
}

/** Chip icons by directive type, for the rich input's chips. */
export const MentionIconsContext = createContext<ReadonlyMap<string, IconComponent>>(new Map());

export function useMentionIcon(type: string): IconComponent | undefined {
	return useContext(MentionIconsContext).get(type);
}

export function mentionIcons(
	sources: readonly MentionSource[],
): ReadonlyMap<string, IconComponent> {
	return new Map(
		sources.flatMap((source) =>
			source.implementation.icon ? [[mentionType(source.key), source.implementation.icon]] : [],
		),
	);
}

type Unstable_TriggerAdapter = NonNullable<
	ComponentPropsWithoutRef<typeof ComposerPrimitive.Unstable_TriggerPopover>["adapter"]
>;

const MAX_CACHED_QUERIES = 50;

interface SearchState {
	readonly results: Map<string, readonly Unstable_TriggerItem[]>;
	readonly icons: Map<string, IconComponent>;
	shown: readonly Unstable_TriggerItem[];
	pending: { readonly query: string; readonly controller: AbortController } | undefined;
}

/**
 * Feeds a source's async `search` to the trigger popover, which asks for
 * items synchronously: an unseen query starts a search (cancelling the one
 * before) and shows the last results until it answers; answers are kept per
 * query while the composer's folder stays the same.
 */
export function useMentionAdapter(
	source: MentionSource,
	context: Omit<ComposerContext, "chatId">,
): {
	adapter: Unstable_TriggerAdapter;
	isLoading: boolean;
	icons: ReadonlyMap<string, IconComponent>;
} {
	const [version, setVersion] = useState(0);
	const contextKey = `${context.workSessionId}\n${context.directory}\n${context.workspaceFolders.map((folder) => folder.path).join("\n")}`;
	const latest = useRef(context);
	latest.current = context;
	const state = useRef<SearchState>({
		results: new Map(),
		icons: new Map(),
		shown: [],
		pending: undefined,
	});

	useEffect(() => {
		const current = state.current;
		current.results.clear();
		current.shown = [];
		return () => current.pending?.controller.abort();
	}, [contextKey]);

	const adapter = useMemo<Unstable_TriggerAdapter>(() => {
		const type = mentionType(source.key);
		const lookup = (query: string): readonly Unstable_TriggerItem[] => {
			const current = state.current;
			const cached = current.results.get(query);
			if (cached) {
				current.shown = cached;
				return cached;
			}
			if (current.pending?.query !== query) {
				current.pending?.controller.abort();
				const controller = new AbortController();
				current.pending = { query, controller };
				const settle = (items: readonly MentionItem[]) => {
					if (controller.signal.aborted) return;
					if (current.results.size >= MAX_CACHED_QUERIES) current.results.clear();
					current.results.set(
						query,
						items.map((item) => {
							if (item.icon) current.icons.set(item.id, item.icon);
							return {
								id: item.id,
								type,
								label: item.label,
								...(item.detail ? { description: item.detail } : {}),
							};
						}),
					);
					current.pending = undefined;
					setVersion((value) => value + 1);
				};
				void Promise.resolve()
					.then(() =>
						source.implementation.search(query, { ...latest.current, signal: controller.signal }),
					)
					.then(settle, (error: unknown) => {
						if (!controller.signal.aborted) {
							console.warn(`[kilo.chat] ${source.key} could not search mentions`, error);
						}
						settle([]);
					});
			}
			return current.shown;
		};
		return { categories: () => [], categoryItems: () => lookup(""), search: lookup };
		// `version` re-creates the adapter so the popover asks again once results arrive.
	}, [source, version, contextKey]);

	return { adapter, isLoading: state.current.pending !== undefined, icons: state.current.icons };
}

const MentionTrigger: FC<{
	source: MentionSource;
	context: Omit<ComposerContext, "chatId">;
	formatter: Unstable_DirectiveFormatter;
}> = ({ source, context, formatter }) => {
	const { adapter, isLoading, icons } = useMentionAdapter(source, context);
	const SourceIcon: IconComponent = source.implementation.icon ?? AtSignIcon;
	const noun = source.title.toLocaleLowerCase();
	const directive = useMemo(() => ({ formatter }), [formatter]);
	const renderItemIcon = useCallback(
		(item: Unstable_TriggerItem) => {
			const Icon = icons.get(item.id);
			return Icon ? <Icon className="size-3.5 shrink-0" /> : null;
		},
		[icons],
	);
	return (
		<ComposerTriggerPopover
			char={source.trigger}
			adapter={adapter}
			directive={directive}
			fallbackIcon={SourceIcon}
			renderItemIcon={renderItemIcon}
			isLoading={isLoading}
			emptyItemsLabel={`No matching ${noun}`}
			loadingLabel={`Loading ${noun}…`}
		/>
	);
};

/** One trigger popover per mention source. */
export const MentionTriggers: FC<{
	sources: readonly MentionSource[];
	context: Omit<ComposerContext, "chatId">;
	formatter: Unstable_DirectiveFormatter;
}> = ({ sources, context, formatter }) => (
	<>
		{sources.map((source) => (
			<MentionTrigger key={source.key} source={source} context={context} formatter={formatter} />
		))}
	</>
);
