import type {
	ComposerPrimitive,
	Unstable_DirectiveFormatter,
	Unstable_TriggerItem,
} from "@assistant-ui/react";
import { AtSignIcon } from "lucide-react";
import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ComponentPropsWithoutRef,
	type FC,
} from "react";

import { useExtensions } from "@kilo-desktop/kernel/web";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

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
	return contributions.flatMap((contribution) =>
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

type TriggerItems = readonly Unstable_TriggerItem[];

/** Search answers by query, for one composer context. */
interface Answers {
	readonly contextKey: string;
	readonly byQuery: ReadonlyMap<string, TriggerItems>;
}

const NO_ANSWERS: ReadonlyMap<string, TriggerItems> = new Map();

function withAnswer(
	answers: Answers,
	contextKey: string,
	query: string,
	items: TriggerItems,
): Answers {
	const previous = answers.contextKey === contextKey ? answers.byQuery : NO_ANSWERS;
	const byQuery = new Map(previous.size >= MAX_CACHED_QUERIES ? [] : previous);
	byQuery.set(query, items);
	return { contextKey, byQuery };
}

/**
 * The in-flight search and the items last shown for a source. The popover asks
 * for items during render, so this lives outside React state: starting a
 * search there must not schedule an update.
 */
class MentionSearch {
	readonly icons = new Map<string, IconComponent>();
	#shown: { readonly contextKey: string; readonly items: TriggerItems } | undefined;
	#pending:
		| { readonly query: string; readonly contextKey: string; readonly controller: AbortController }
		| undefined;

	get isLoading(): boolean {
		return this.#pending !== undefined;
	}

	show(contextKey: string, items: TriggerItems): TriggerItems {
		this.#shown = { contextKey, items };
		return items;
	}

	shownFor(contextKey: string): TriggerItems {
		return this.#shown?.contextKey === contextKey ? this.#shown.items : [];
	}

	/** Starts searching `query` unless it already is, cancelling the search before. */
	start(
		query: string,
		contextKey: string,
		search: (signal: AbortSignal) => Promise<readonly MentionItem[]>,
		onAnswer: (items: readonly MentionItem[]) => void,
		onFailure: (error: unknown) => void,
	): void {
		if (this.#pending?.query === query && this.#pending.contextKey === contextKey) return;
		this.#pending?.controller.abort();
		const controller = new AbortController();
		const pending = { query, contextKey, controller };
		this.#pending = pending;
		const settle = (items: readonly MentionItem[]) => {
			if (controller.signal.aborted) return;
			for (const item of items) if (item.icon) this.icons.set(item.id, item.icon);
			if (this.#pending === pending) this.#pending = undefined;
			onAnswer(items);
		};
		void Promise.resolve()
			.then(() => search(controller.signal))
			.then(settle, (error: unknown) => {
				if (!controller.signal.aborted) onFailure(error);
				settle([]);
			});
	}

	abortFor(contextKey: string): void {
		if (this.#pending?.contextKey !== contextKey) return;
		this.#pending.controller.abort();
		this.#pending = undefined;
	}
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
	const contextKey = `${context.workSessionId}\n${context.directory}\n${context.workspaceFolders.map((folder) => folder.path).join("\n")}`;
	const latest = useLatestRef(context);
	const [search] = useState(() => new MentionSearch());
	const [answers, setAnswers] = useState<Answers>({ contextKey, byQuery: NO_ANSWERS });
	const byQuery = answers.contextKey === contextKey ? answers.byQuery : NO_ANSWERS;

	useEffect(() => () => search.abortFor(contextKey), [search, contextKey]);

	// Each answer replaces `byQuery`, and with it the adapter, so the popover asks again.
	const type = mentionType(source.key);
	const toTriggerItem = (item: MentionItem): Unstable_TriggerItem => ({
		id: item.id,
		type,
		label: item.label,
		...(item.detail ? { description: item.detail } : {}),
	});
	const lookup = (query: string): TriggerItems => {
		const cached = byQuery.get(query);
		if (cached) return search.show(contextKey, cached);
		search.start(
			query,
			contextKey,
			(signal) => source.implementation.search(query, { ...latest.current, signal }),
			(items) =>
				setAnswers((current) => withAnswer(current, contextKey, query, items.map(toTriggerItem))),
			(error) => console.warn(`[kilo.chat] ${source.key} could not search mentions`, error),
		);
		return search.shownFor(contextKey);
	};
	const adapter: Unstable_TriggerAdapter = {
		categories: () => [],
		categoryItems: () => lookup(""),
		search: lookup,
	};

	return { adapter, isLoading: search.isLoading, icons: search.icons };
}

const MentionTrigger: FC<{
	source: MentionSource;
	context: Omit<ComposerContext, "chatId">;
	formatter: Unstable_DirectiveFormatter;
}> = ({ source, context, formatter }) => {
	const { adapter, isLoading, icons } = useMentionAdapter(source, context);
	const SourceIcon: IconComponent = source.implementation.icon ?? AtSignIcon;
	const noun = source.title.toLocaleLowerCase();
	const directive = { formatter };
	const renderItemIcon = (item: Unstable_TriggerItem) => {
		const Icon = icons.get(item.id);
		return Icon ? <Icon className="size-3.5 shrink-0" /> : null;
	};
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
