import { lazy, Suspense, type ComponentType, type FC } from "react";
import { LayoutTemplateIcon, ListTodoIcon, type LucideIcon } from "lucide-react";

const PlaceholderTab = lazy(() =>
	import("./PlaceholderTab.js").then((module) => ({ default: module.PlaceholderTab })),
);
const PlanTab = lazy(() => import("./PlanTab.js").then((module) => ({ default: module.PlanTab })));

type RightPanelTabDefinitionFields = {
	title: string;
	description: string;
	Icon: LucideIcon;
	/** Shown in the empty state and the tab-bar add menu. */
	addable: boolean;
	Content: ComponentType;
};

/**
 * Single place to register right-panel tabs.
 * Add an entry here (and create the matching `*Tab` component file).
 */
export const RIGHT_PANEL_TAB_REGISTRY = {
	placeholder: {
		title: "Placeholder",
		description: "Stub tab for wiring the right panel.",
		Icon: LayoutTemplateIcon,
		addable: true,
		Content: PlaceholderTab,
	},
	plan: {
		title: "Plan",
		description: "Proposed plan from the plan agent.",
		Icon: ListTodoIcon,
		addable: false,
		Content: PlanTab,
	},
} as const satisfies Record<string, RightPanelTabDefinitionFields>;

export type RightPanelTabKind = keyof typeof RIGHT_PANEL_TAB_REGISTRY;

export type RightPanelTabDefinition = RightPanelTabDefinitionFields & {
	kind: RightPanelTabKind;
};

export type RightPanelTab = {
	[K in RightPanelTabKind]: { id: K; kind: K };
}[RightPanelTabKind];

export const RIGHT_PANEL_TAB_KINDS = Object.keys(RIGHT_PANEL_TAB_REGISTRY) as RightPanelTabKind[];

export const PLAN_TAB_KIND = "plan" satisfies RightPanelTabKind;

export function isRightPanelTabKind(value: string): value is RightPanelTabKind {
	return Object.hasOwn(RIGHT_PANEL_TAB_REGISTRY, value);
}

export function createRightPanelTab(kind: RightPanelTabKind): RightPanelTab {
	return { id: kind, kind } as RightPanelTab;
}

export function isRightPanelTab(value: unknown): value is RightPanelTab {
	if (!value || typeof value !== "object") return false;
	const tab = value as { id?: unknown; kind?: unknown };
	return (
		typeof tab.id === "string" &&
		typeof tab.kind === "string" &&
		tab.id === tab.kind &&
		isRightPanelTabKind(tab.kind)
	);
}

export function getRightPanelTabDefinition(kind: RightPanelTabKind): RightPanelTabDefinition {
	return { kind, ...RIGHT_PANEL_TAB_REGISTRY[kind] };
}

export const ADDABLE_RIGHT_PANEL_TABS: readonly RightPanelTabDefinition[] =
	RIGHT_PANEL_TAB_KINDS.map((kind) => getRightPanelTabDefinition(kind)).filter(
		(definition) => definition.addable,
	);

export const RightPanelTabContent: FC<{ tab: RightPanelTab }> = ({ tab }) => {
	const { Content } = getRightPanelTabDefinition(tab.kind);
	return (
		<Suspense fallback={null}>
			<Content />
		</Suspense>
	);
};
