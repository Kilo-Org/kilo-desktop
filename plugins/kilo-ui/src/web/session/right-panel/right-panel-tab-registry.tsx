import { lazy, Suspense, useMemo, type ComponentType, type FC } from "react";
import { BotIcon, CircleQuestionMarkIcon, LayoutTemplateIcon, ListTodoIcon } from "lucide-react";

import type { Contribution, ContributionMountPolicy } from "@kilo-desktop/feature-sdk";
import { useSdkContributions } from "@kilo-desktop/sdk-react";

const PlanTab = lazy(() =>
	import("../../chat/plan/PlanTab.js").then((module) => ({ default: module.PlanTab })),
);
const SubagentPane = lazy(() =>
	import("../../chat/subagents/SubagentPane.js").then((module) => ({
		default: module.SubagentPane,
	})),
);

export const CHAT_RIGHT_PANEL_TAB_EXTENSION = "kilo-ui/chat-right-panel-tab";

/** Context Kilo supplies when it renders a contributed pane. */
export interface ChatRightPanelContributionProps {
	/** The work session that owns the pane (not its chat's Kilo session id). */
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
	readonly workspaceDirectory?: string;
	readonly workspaceFolders?: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
	readonly metadata?: Readonly<Record<string, string>>;
}

export const PLAN_TAB_DEFINITION_ID = "kilo-ui.plan";
export const SUBAGENT_TAB_DEFINITION_ID = "kilo-ui.subagent";

export interface RightPanelTabIconProps {
	readonly className?: string;
	/** Contribution-owned value whose meaning is opaque to Kilo. */
	readonly iconKey?: string;
}

export interface RightPanelTabDefinition {
	id: string;
	title: string;
	description: string;
	Icon: ComponentType<RightPanelTabIconProps>;
	addable: boolean;
	/** Offered in the "+" menu only while the user is signed in to Kilo. */
	requiresSignIn: boolean;
	/** Why the "+" menu entry is disabled while signed out. */
	signInHint?: string;
	mountPolicy: ContributionMountPolicy;
	Content: ComponentType<ChatRightPanelContributionProps>;
}

export interface RightPanelTab {
	instanceId: string;
	definitionId: string;
	title: string;
	/** Optional contribution-owned value used to render a tab-specific icon. */
	iconKey?: string;
	ordinal: number | null;
	/** Contribution-owned, serializable state that must survive tab restoration. */
	metadata?: Readonly<Record<string, string>>;
	/** Transient unsaved-work state; intentionally excluded from persisted tab layout. */
	dirty?: boolean;
	/** Runtime-only placeholder state; transient tabs are omitted from persisted layout. */
	transient?: boolean;
}

export interface CreateContributedTabOptions {
	readonly instanceId?: string;
	readonly title?: string;
	readonly iconKey?: string;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly transient?: boolean;
	/** When false, the new pane is added without becoming the focused tab. */
	readonly activate?: boolean;
}

export interface RightPanelTabUpdate {
	readonly title?: string;
	readonly iconKey?: string;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly dirty?: boolean;
	readonly transient?: boolean;
}

const PLAN_TAB_DEFINITION: RightPanelTabDefinition = {
	id: PLAN_TAB_DEFINITION_ID,
	title: "Plan",
	description: "Proposed plan from the plan agent.",
	Icon: ListTodoIcon,
	addable: false,
	requiresSignIn: false,
	mountPolicy: "active-only",
	Content: PlanTab,
};

export const SUBAGENT_TAB_DEFINITION: RightPanelTabDefinition = {
	id: SUBAGENT_TAB_DEFINITION_ID,
	title: "Subagent",
	description: "Read-only live subagent conversation.",
	Icon: BotIcon,
	addable: false,
	requiresSignIn: false,
	mountPolicy: "active-only",
	Content: SubagentPane,
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
					contribution.description ?? `Open another ${contribution.label} for this session.`,
				Icon: isRenderableComponent(contribution.icon)
					? (contribution.icon as ComponentType<RightPanelTabIconProps>)
					: LayoutTemplateIcon,
				addable: true,
				requiresSignIn: contribution.requiresSignIn === true,
				...(contribution.signInHint ? { signInHint: contribution.signInHint } : {}),
				mountPolicy: contribution.mountPolicy ?? "active-only",
				Content: contribution.component,
			},
		];
	});
}

export function useRightPanelTabDefinitions(): readonly RightPanelTabDefinition[] {
	const contributions = useSdkContributions(CHAT_RIGHT_PANEL_TAB_EXTENSION);
	return useMemo(
		() => [
			PLAN_TAB_DEFINITION,
			SUBAGENT_TAB_DEFINITION,
			...buildContributedTabDefinitions(contributions),
		],
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
	options: CreateContributedTabOptions = {},
): RightPanelTab {
	const ordinal =
		Math.max(
			0,
			...currentTabs
				.filter((tab) => tab.definitionId === definition.id)
				.map((tab) => tab.ordinal ?? 0),
		) + 1;
	// Instance identity is independent from the contribution definition so
	// consumers can pass it to their own backing services without decoding a
	// host-owned prefix.
	return {
		instanceId: options.instanceId ?? createId(),
		definitionId: definition.id,
		title: options.title ?? `${definition.title} ${String(ordinal)}`,
		ordinal,
		...(options.iconKey ? { iconKey: options.iconKey } : {}),
		...(options.metadata ? { metadata: { ...options.metadata } } : {}),
		...(options.transient ? { transient: true } : {}),
	};
}

function isTabMetadata(value: unknown): value is Readonly<Record<string, string>> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((entry) => typeof entry === "string")
	);
}

export function isRightPanelTab(value: unknown): value is RightPanelTab {
	if (!value || typeof value !== "object") return false;
	const tab = value as Partial<RightPanelTab>;
	return (
		typeof tab.instanceId === "string" &&
		typeof tab.definitionId === "string" &&
		typeof tab.title === "string" &&
		(tab.ordinal === null || (typeof tab.ordinal === "number" && Number.isInteger(tab.ordinal))) &&
		(tab.iconKey === undefined || typeof tab.iconKey === "string") &&
		(tab.metadata === undefined || isTabMetadata(tab.metadata)) &&
		(tab.transient === undefined || typeof tab.transient === "boolean")
	);
}

function MissingContributionTab({ title }: ChatRightPanelContributionProps) {
	return (
		<div
			className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center"
			data-qa-id="chat-pane-contribution-unavailable"
		>
			<CircleQuestionMarkIcon className="size-6" />
			<p className="text-foreground text-sm font-medium">{title} is unavailable</p>
			<p className="text-xs">The plugin that contributed this tab is not currently loaded.</p>
		</div>
	);
}

export const RightPanelTabContent: FC<{
	tab: RightPanelTab;
	sessionId: string;
	definitions: readonly RightPanelTabDefinition[];
	workspaceDirectory?: string;
	workspaceFolders?: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
}> = ({ tab, sessionId, definitions, workspaceDirectory, workspaceFolders }) => {
	const definition = definitions.find(({ id }) => id === tab.definitionId);
	const Content = definition?.Content ?? MissingContributionTab;
	return (
		<Suspense fallback={null}>
			<Content
				sessionId={sessionId}
				instanceId={tab.instanceId}
				title={tab.title}
				{...(workspaceDirectory ? { workspaceDirectory } : {})}
				{...(workspaceFolders ? { workspaceFolders } : {})}
				{...(tab.metadata ? { metadata: tab.metadata } : {})}
			/>
		</Suspense>
	);
};
