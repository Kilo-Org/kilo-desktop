import { lazy, Suspense, useMemo, type ComponentType, type FC } from "react";
import { CircleHelpIcon, LayoutTemplateIcon, ListTodoIcon, type LucideIcon } from "lucide-react";

import type { Contribution } from "@anaconda-agentic-desktop/feature-sdk";
import { useSdkContributions } from "@anaconda-agentic-desktop/sdk-react";

const PlanTab = lazy(() => import("./PlanTab.js").then((module) => ({ default: module.PlanTab })));

export const CHAT_RIGHT_PANEL_TAB_EXTENSION = "kilo-ui/chat-right-panel-tab";

/** Context Kilo supplies when it renders a right-panel tab contribution. */
export interface ChatRightPanelContributionProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
}

export const PLAN_TAB_DEFINITION_ID = "kilo-ui.plan";

export interface RightPanelTabDefinition {
	id: string;
	title: string;
	description: string;
	Icon: LucideIcon;
	addable: boolean;
	Content: ComponentType<ChatRightPanelContributionProps>;
}

export interface RightPanelTab {
	instanceId: string;
	definitionId: string;
	title: string;
	ordinal: number | null;
}

const PLAN_TAB_DEFINITION: RightPanelTabDefinition = {
	id: PLAN_TAB_DEFINITION_ID,
	title: "Plan",
	description: "Proposed plan from the plan agent.",
	Icon: ListTodoIcon,
	addable: false,
	Content: PlanTab,
};

function isRenderableComponent(
	value: unknown,
): value is ComponentType<ChatRightPanelContributionProps> {
	return typeof value === "function" || (typeof value === "object" && value !== null);
}

export function contributionDefinitionId(contribution: Pick<Contribution, "featureId" | "id">) {
	return `${contribution.featureId}.${contribution.id}`;
}

export function buildContributedTabDefinitions(
	contributions: readonly Contribution[],
): RightPanelTabDefinition[] {
	return contributions.flatMap((contribution) => {
		if (!isRenderableComponent(contribution.component)) return [];
		return [
			{
				id: contributionDefinitionId(contribution),
				title: contribution.label,
				description:
					contribution.description ?? `Open another ${contribution.label} for this chat.`,
				Icon: isRenderableComponent(contribution.icon)
					? (contribution.icon as LucideIcon)
					: LayoutTemplateIcon,
				addable: true,
				Content: contribution.component,
			},
		];
	});
}

export function useRightPanelTabDefinitions(): readonly RightPanelTabDefinition[] {
	const contributions = useSdkContributions(CHAT_RIGHT_PANEL_TAB_EXTENSION);
	return useMemo(
		() => [PLAN_TAB_DEFINITION, ...buildContributedTabDefinitions(contributions)],
		[contributions],
	);
}

export function createPlanTab(): RightPanelTab {
	return {
		instanceId: "plan",
		definitionId: PLAN_TAB_DEFINITION_ID,
		title: "Plan",
		ordinal: null,
	};
}

export function createContributedTab(
	currentTabs: readonly RightPanelTab[],
	definition: Pick<RightPanelTabDefinition, "id" | "title">,
	createId: () => string = () => crypto.randomUUID(),
): RightPanelTab {
	const ordinal =
		Math.max(
			0,
			...currentTabs
				.filter((tab) => tab.definitionId === definition.id)
				.map((tab) => tab.ordinal ?? 0),
		) + 1;
	// Bare id — for notebook tabs this value is nteract/runt's `notebook_id`.
	// Do not prefix with `definition.id`: runtined rooms keyed as
	// `notebook.notebook:<uuid>` are invisible to nteract MCP tools that look
	// up the bare UUID (daemon: "not resident … refusing (gone)").
	return {
		instanceId: createId(),
		definitionId: definition.id,
		title: `${definition.title} ${String(ordinal)}`,
		ordinal,
	};
}

export function isRightPanelTab(value: unknown): value is RightPanelTab {
	if (!value || typeof value !== "object") return false;
	const tab = value as Partial<RightPanelTab>;
	return (
		typeof tab.instanceId === "string" &&
		typeof tab.definitionId === "string" &&
		typeof tab.title === "string" &&
		(tab.ordinal === null || (typeof tab.ordinal === "number" && Number.isInteger(tab.ordinal)))
	);
}

function MissingContributionTab({ title }: ChatRightPanelContributionProps) {
	return (
		<div
			className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center"
			data-qa-id="chat-right-panel-contribution-unavailable"
		>
			<CircleHelpIcon className="size-6" />
			<p className="text-foreground text-sm font-medium">{title} is unavailable</p>
			<p className="text-xs">The plugin that contributed this tab is not currently loaded.</p>
		</div>
	);
}

export const RightPanelTabContent: FC<{
	tab: RightPanelTab;
	sessionId: string;
	definitions: readonly RightPanelTabDefinition[];
}> = ({ tab, sessionId, definitions }) => {
	const definition = definitions.find(({ id }) => id === tab.definitionId);
	const Content = definition?.Content ?? MissingContributionTab;
	return (
		<Suspense fallback={null}>
			<Content sessionId={sessionId} instanceId={tab.instanceId} title={tab.title} />
		</Suspense>
	);
};
