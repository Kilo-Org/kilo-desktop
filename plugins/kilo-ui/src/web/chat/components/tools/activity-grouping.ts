import { getMcpAppFromToolPart, type GroupByContext, type PartState } from "@assistant-ui/react";

import { shouldExcludeToolCallFromActivityGroup } from "../../plan/plan-projection.js";
import { isHostableMcpAppTool } from "../../runtime/mcp-app-registry.js";
import { isHiddenOpenCodeDataPart } from "./opencode-data-part.js";
import { isSignInRefusedToolPart } from "./tool-sign-in.js";
import {
	getGroupKeyForTool,
	isComposerProjectedTool,
	isDelegationTool,
} from "./tool-categories.js";

type ActivityGroupPath = readonly ["group-activity", `group-${string}`];

export const DELEGATION_GROUP_PREFIX = "group-delegation-";
type DelegationGroupKey = `${typeof DELEGATION_GROUP_PREFIX}${number}`;
type DirectPath = ActivityGroupPath | readonly [DelegationGroupKey];

type ActivityGroupingOptions = {
	hiddenPlanCallIds?: ReadonlySet<string> | undefined;
};

type ActivityNeighbors = {
	before?: PartState | undefined;
	after?: PartState | undefined;
};

const isComposerProjectedPart = (part: PartState): boolean =>
	part.type === "tool-call" && isComposerProjectedTool(part.toolName);

const isHiddenStructuralPart = (part: PartState): boolean =>
	(part.type === "data" && isHiddenOpenCodeDataPart(part.name)) || isComposerProjectedPart(part);

const isActivityPart = (part: PartState): boolean =>
	part.type === "reasoning" || part.type === "tool-call";

const isDelegationPart = (part: PartState): boolean =>
	part.type === "tool-call" && isDelegationTool(part.toolName);

const rendersNothing = (part: PartState): boolean =>
	isHiddenStructuralPart(part) ||
	((part.type === "text" || part.type === "reasoning") && !part.text.trim());

/**
 * Subagent delegations get their own group, sealed off from activity groups:
 * one per run of consecutive `task` calls, where parts that render nothing do
 * not break a run. Keys depend only on part order, never on live subagent
 * status, so group boundaries stay put as subagents finish.
 */
const indexDelegationGroups = (
	parts: readonly PartState[],
): ReadonlyMap<PartState, DelegationGroupKey> => {
	const keys = new Map<PartState, DelegationGroupKey>();
	let run = -1;
	let inRun = false;
	// Invisible parts between two delegations of a run join it, so they cannot
	// split the rendered group.
	let gap: PartState[] = [];
	for (const part of parts) {
		if (isDelegationPart(part)) {
			if (!inRun) run += 1;
			inRun = true;
			const key: DelegationGroupKey = `${DELEGATION_GROUP_PREFIX}${run}`;
			for (const gapPart of gap) keys.set(gapPart, key);
			keys.set(part, key);
			gap = [];
		} else if (inRun && rendersNothing(part)) {
			gap.push(part);
		} else {
			inRun = false;
			gap = [];
		}
	}
	return keys;
};

const getDirectActivityPath = (
	part: PartState,
	context: GroupByContext,
	options: ActivityGroupingOptions,
): ActivityGroupPath | undefined => {
	if (part.type === "reasoning") {
		return ["group-activity", "group-thinking"];
	}
	if (part.type !== "tool-call") return undefined;
	if (shouldKeepPartOutsideActivity(part, context, options)) return undefined;
	return ["group-activity", getGroupKeyForTool(part.toolName)];
};

const shouldKeepPartOutsideActivity = (
	part: PartState,
	context: GroupByContext,
	options: ActivityGroupingOptions,
): boolean =>
	part.type === "tool-call" &&
	(isComposerProjectedPart(part) ||
		isSignInRefusedToolPart(part) ||
		Boolean(getMcpAppFromToolPart(part) && isHostableMcpAppTool(part.toolName)) ||
		Boolean(context.toolUIs?.[part.toolName]?.[0]?.standalone) ||
		shouldExcludeToolCallFromActivityGroup(part, options));

const indexHiddenActivityNeighbors = (
	parts: readonly PartState[],
): ReadonlyMap<PartState, ActivityNeighbors> => {
	const neighbors = new Map<PartState, ActivityNeighbors>();
	let candidate: PartState | undefined;

	for (const part of parts) {
		if (isHiddenStructuralPart(part)) {
			neighbors.set(part, { before: candidate });
			continue;
		}
		candidate = isActivityPart(part) ? part : undefined;
	}

	candidate = undefined;
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index]!;
		if (isHiddenStructuralPart(part)) {
			const current = neighbors.get(part);
			neighbors.set(part, { ...current, after: candidate });
			continue;
		}
		candidate = isActivityPart(part) ? part : undefined;
	}

	return neighbors;
};

/**
 * Builds hierarchical activity grouping while treating hidden parts (OpenCode
 * lifecycle markers and composer-projected task-list calls) as
 * transparent. Those parts must inherit a neighboring subgroup path; assigning
 * only `group-activity` closes and reopens the inner tool-kind group even
 * though the hidden part renders nothing.
 */
export const createActivityGroupBy = (
	parts: readonly PartState[],
	options: ActivityGroupingOptions = {},
) => {
	const hiddenNeighbors = indexHiddenActivityNeighbors(parts);
	const delegationGroups = indexDelegationGroups(parts);
	const getDirectPath = (part: PartState, context: GroupByContext): DirectPath | undefined => {
		const delegationGroup = delegationGroups.get(part);
		if (delegationGroup) return [delegationGroup];
		return getDirectActivityPath(part, context, options);
	};

	return (part: PartState, context: GroupByContext): readonly `group-${string}`[] => {
		const directPath = getDirectPath(part, context);
		if (directPath) return directPath;
		if (!isHiddenStructuralPart(part)) return [];

		const neighbors = hiddenNeighbors.get(part);
		const beforePath = neighbors?.before && getDirectPath(neighbors.before, context);
		const afterPath = neighbors?.after && getDirectPath(neighbors.after, context);
		return beforePath || afterPath || ["group-activity"];
	};
};

const isFoldableWork = (
	part: PartState,
	context: GroupByContext,
	options: ActivityGroupingOptions,
): boolean =>
	(part.type === "reasoning" && Boolean(part.text.trim())) ||
	(part.type === "tool-call" && !shouldKeepPartOutsideActivity(part, context, options));

type TurnWorkLayout = {
	/** -1 when the turn has no final answer to leave outside the fold. */
	finalTextIndex: number;
	firstStandaloneIndex: number;
	hasVisibleWork: boolean;
};

/**
 * Adds a turn-level fold around everything before the final assistant text.
 * A turn that ends in work (e.g. narration followed by delegations) has no
 * final answer, so its last text folds with the rest. Standalone tools stay
 * outside because they can remain actionable after the surrounding turn settles.
 */
export const createTurnWorkGroupBy = (
	parts: readonly PartState[],
	options: ActivityGroupingOptions = {},
) => {
	const activityGroupBy = createActivityGroupBy(parts, options);
	const indices = new Map(parts.map((part, index) => [part, index]));
	const layoutByContext = new WeakMap<GroupByContext, TurnWorkLayout>();
	const layoutFor = (context: GroupByContext): TurnWorkLayout => {
		const cached = layoutByContext.get(context);
		if (cached) return cached;
		let finalTextIndex = -1;
		for (let index = parts.length - 1; index >= 0; index -= 1) {
			const part = parts[index]!;
			if (part.type === "text" && part.text.trim()) {
				finalTextIndex = index;
				break;
			}
			if (isFoldableWork(part, context, options)) break;
		}
		const firstStandaloneIndex = parts.findIndex(
			(candidate) =>
				shouldKeepPartOutsideActivity(candidate, context, options) &&
				!isHiddenStructuralPart(candidate),
		);
		const hasVisibleWork = parts.some((candidate, candidateIndex) => {
			if (finalTextIndex >= 0 && candidateIndex >= finalTextIndex) return false;
			if (candidate.type === "text") return Boolean(candidate.text.trim());
			return isFoldableWork(candidate, context, options);
		});
		const layout = { finalTextIndex, firstStandaloneIndex, hasVisibleWork };
		layoutByContext.set(context, layout);
		return layout;
	};

	return (part: PartState, context: GroupByContext): readonly `group-${string}`[] => {
		const activityPath = activityGroupBy(part, context);
		const index = indices.get(part) ?? -1;
		const { finalTextIndex, firstStandaloneIndex, hasVisibleWork } = layoutFor(context);
		const followsStandalonePart = firstStandaloneIndex >= 0 && firstStandaloneIndex < index;
		if (
			!hasVisibleWork ||
			index < 0 ||
			followsStandalonePart ||
			(finalTextIndex >= 0 && index >= finalTextIndex) ||
			(shouldKeepPartOutsideActivity(part, context, options) && !isHiddenStructuralPart(part))
		) {
			return activityPath;
		}
		return ["group-turn-work", ...activityPath];
	};
};
