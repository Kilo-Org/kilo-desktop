import { getMcpAppFromToolPart, type GroupByContext, type PartState } from "@assistant-ui/react";

import { shouldExcludeToolCallFromActivityGroup } from "../../plan/plan-projection.js";
import { isHostableMcpAppTool } from "../../runtime/mcp-app-registry.js";
import { isHiddenOpenCodeDataPart } from "./opencode-data-part.js";
import { getGroupKeyForTool, isSuggestTool } from "./tool-categories.js";

type ActivityGroupPath = readonly [`group-activity${string}`, `group-${string}`];

type ActivityGroupingOptions = {
	hiddenPlanCallIds?: ReadonlySet<string> | undefined;
	activeSubagentToolCallIds?: ReadonlySet<string> | undefined;
};

type ActivityNeighbors = {
	before?: PartState | undefined;
	after?: PartState | undefined;
};

const isProjectedTaskPart = (part: PartState): boolean =>
	part.type === "tool-call" && ["todowrite", "todoread"].includes(part.toolName.toLowerCase());

const isHiddenStructuralPart = (part: PartState): boolean =>
	(part.type === "data" && isHiddenOpenCodeDataPart(part.name)) || isProjectedTaskPart(part);

const isActivityPart = (part: PartState): boolean =>
	part.type === "reasoning" || part.type === "tool-call";

const isActiveSubagentPart = (
	part: PartState,
	activeSubagentToolCallIds: ReadonlySet<string> | undefined,
): boolean =>
	part.type === "tool-call" &&
	part.toolName.toLowerCase() === "task" &&
	Boolean(activeSubagentToolCallIds?.has(part.toolCallId));

const indexActivityGroupKeys = (
	parts: readonly PartState[],
	activeSubagentToolCallIds: ReadonlySet<string> | undefined,
): ReadonlyMap<PartState, `group-activity${string}`> => {
	const keys = new Map<PartState, `group-activity${string}`>();
	let groupIndex = 0;
	let pendingBoundary = false;

	for (const part of parts) {
		if (
			pendingBoundary &&
			!isActiveSubagentPart(part, activeSubagentToolCallIds) &&
			(!isHiddenStructuralPart(part) ||
				(part.type === "data" && part.name === "opencode-step-start"))
		) {
			groupIndex += 1;
			pendingBoundary = false;
		}

		keys.set(part, groupIndex === 0 ? "group-activity" : `group-activity-${groupIndex}`);
		if (isActiveSubagentPart(part, activeSubagentToolCallIds)) pendingBoundary = true;
	}

	return keys;
};

const getDirectActivityPath = (
	part: PartState,
	context: GroupByContext,
	options: ActivityGroupingOptions,
	activityGroupKey: `group-activity${string}` = "group-activity",
): ActivityGroupPath | undefined => {
	if (part.type === "reasoning") {
		return [activityGroupKey, "group-thinking"];
	}
	if (part.type !== "tool-call") return undefined;
	if (shouldKeepPartOutsideActivity(part, context, options)) return undefined;
	return [activityGroupKey, getGroupKeyForTool(part.toolName)];
};

const shouldKeepPartOutsideActivity = (
	part: PartState,
	context: GroupByContext,
	options: ActivityGroupingOptions,
): boolean =>
	part.type === "tool-call" &&
	(isSuggestTool(part.toolName) ||
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
 * Builds hierarchical activity grouping while treating hidden OpenCode
 * lifecycle parts as transparent. Those parts must inherit a neighboring
 * subgroup path; assigning only `group-activity` closes and reopens the inner
 * tool-kind group even though the lifecycle part renders nothing.
 */
export const createActivityGroupBy = (
	parts: readonly PartState[],
	options: ActivityGroupingOptions = {},
) => {
	const hiddenNeighbors = indexHiddenActivityNeighbors(parts);
	const activityGroupKeys = indexActivityGroupKeys(parts, options.activeSubagentToolCallIds);

	return (part: PartState, context: GroupByContext): readonly `group-${string}`[] => {
		const activityGroupKey = activityGroupKeys.get(part) ?? "group-activity";
		const directPath = getDirectActivityPath(part, context, options, activityGroupKey);
		if (directPath) return directPath;
		if (!isHiddenStructuralPart(part)) return [];

		const neighbors = hiddenNeighbors.get(part);
		const beforePath =
			neighbors?.before &&
			activityGroupKeys.get(neighbors.before) === activityGroupKey &&
			getDirectActivityPath(neighbors.before, context, options, activityGroupKey);
		const afterPath =
			neighbors?.after &&
			activityGroupKeys.get(neighbors.after) === activityGroupKey &&
			getDirectActivityPath(neighbors.after, context, options, activityGroupKey);
		return beforePath || afterPath || [activityGroupKey];
	};
};

/**
 * Adds a turn-level fold around everything before the final assistant text.
 * Standalone tools stay outside because they can remain actionable after the
 * surrounding turn settles.
 */
export const createTurnWorkGroupBy = (
	parts: readonly PartState[],
	options: ActivityGroupingOptions = {},
) => {
	const activityGroupBy = createActivityGroupBy(parts, options);
	const indices = new Map(parts.map((part, index) => [part, index]));
	let finalTextIndex = -1;
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];
		if (part?.type === "text" && part.text.trim()) {
			finalTextIndex = index;
			break;
		}
	}
	let hasVisibleWork: boolean | undefined;
	const firstStandaloneIndexByContext = new WeakMap<GroupByContext, number>();

	return (part: PartState, context: GroupByContext): readonly `group-${string}`[] => {
		const activityPath = activityGroupBy(part, context);
		const index = indices.get(part) ?? -1;
		let firstStandaloneIndex = firstStandaloneIndexByContext.get(context);
		if (firstStandaloneIndex === undefined) {
			firstStandaloneIndex = parts.findIndex(
				(candidate) =>
					shouldKeepPartOutsideActivity(candidate, context, options) &&
					!isHiddenStructuralPart(candidate),
			);
			firstStandaloneIndexByContext.set(context, firstStandaloneIndex);
		}
		const followsStandalonePart = firstStandaloneIndex >= 0 && firstStandaloneIndex < index;
		hasVisibleWork ??= parts.some((candidate, candidateIndex) => {
			if (finalTextIndex >= 0 && candidateIndex >= finalTextIndex) return false;
			if (candidate.type === "reasoning") return Boolean(candidate.text.trim());
			if (candidate.type === "text") return Boolean(candidate.text.trim());
			return (
				candidate.type === "tool-call" &&
				!shouldKeepPartOutsideActivity(candidate, context, options)
			);
		});
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
