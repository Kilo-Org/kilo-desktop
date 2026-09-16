import { getMcpAppFromToolPart, type GroupByContext, type PartState } from "@assistant-ui/react";

import { shouldExcludeToolCallFromActivityGroup } from "../../plan/plan-projection.js";
import { isHostableMcpAppTool } from "../../runtime/mcp-app-registry.js";
import { isHiddenOpenCodeDataPart } from "./opencode-data-part.js";
import { getGroupKeyForTool, isSuggestTool } from "./tool-categories.js";

type ActivityGroupPath = readonly ["group-activity", `group-${string}`];

type ActivityGroupingOptions = {
	hiddenPlanCallIds?: ReadonlySet<string> | undefined;
};

type ActivityNeighbors = {
	before?: PartState | undefined;
	after?: PartState | undefined;
};

const isHiddenStructuralPart = (part: PartState): boolean =>
	part.type === "data" && isHiddenOpenCodeDataPart(part.name);

const isActivityPart = (part: PartState): boolean =>
	part.type === "reasoning" || part.type === "tool-call";

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

	return (part: PartState, context: GroupByContext): readonly `group-${string}`[] => {
		const directPath = getDirectActivityPath(part, context, options);
		if (directPath) return directPath;
		if (!isHiddenStructuralPart(part)) return [];

		const neighbors = hiddenNeighbors.get(part);
		return (
			(neighbors?.before && getDirectActivityPath(neighbors.before, context, options)) ||
			(neighbors?.after && getDirectActivityPath(neighbors.after, context, options)) || [
				"group-activity",
			]
		);
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

	return (part: PartState, context: GroupByContext): readonly `group-${string}`[] => {
		const activityPath = activityGroupBy(part, context);
		const index = indices.get(part) ?? -1;
		if (
			index < 0 ||
			(finalTextIndex >= 0 && index >= finalTextIndex) ||
			shouldKeepPartOutsideActivity(part, context, options)
		) {
			return activityPath;
		}
		return ["group-turn-work", ...activityPath];
	};
};
