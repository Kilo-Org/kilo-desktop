import { memo, useMemo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
	type OpenCodePermissionRequest,
	type OpenCodePermissionResponse,
	useOpenCodePermissions,
	useOpenCodeThreadState,
} from "@assistant-ui/react-opencode";

import { OpenCodePermissionCard } from "./opencode-permission-card.js";

type ToolPermissionInteraction = {
	request: OpenCodePermissionRequest;
	state: "pending" | "resolved";
	reply?: OpenCodePermissionResponse;
};

const useOpenCodeToolPermissions = (toolCallId: string) => {
	const interactions = useOpenCodeThreadState((state) => state.interactions);

	return useMemo(() => {
		const permissions: ToolPermissionInteraction[] = [];

		for (const request of Object.values(interactions.permissions.pending)) {
			if (request.tool?.callID === toolCallId) {
				permissions.push({ request, state: "pending" });
			}
		}

		for (const resolved of Object.values(interactions.permissions.resolved)) {
			if (resolved.request.tool?.callID === toolCallId) {
				permissions.push({
					request: resolved.request,
					state: "resolved",
					reply: resolved.reply,
				});
			}
		}

		return permissions;
	}, [interactions, toolCallId]);
};

const ToolPermissionStack = ({ toolCallId }: { toolCallId: string }) => {
	const permissions = useOpenCodeToolPermissions(toolCallId);

	if (permissions.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-3">
			{permissions.map((permission) => (
				<OpenCodePermissionCard
					key={`${permission.request.id}-${permission.state}`}
					request={permission.request}
					state={permission.state}
					{...(permission.reply ? { reply: permission.reply } : {})}
				/>
			))}
		</div>
	);
};

export const OpenCodeUnlinkedPermissionCards = () => {
	const { pending } = useOpenCodePermissions();
	const unlinked = useMemo(
		() => pending.filter((request) => request.tool?.callID === undefined),
		[pending],
	);

	if (unlinked.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-3" data-qa-id="kilo-unlinked-permission-cards">
			{unlinked.map((request) => (
				<OpenCodePermissionCard key={request.id} request={request} state="pending" />
			))}
		</div>
	);
};

export const withOpenCodeToolInteractions = <TArgs = unknown, TResult = unknown>(
	BaseComponent: ToolCallMessagePartComponent<TArgs, TResult>,
): ToolCallMessagePartComponent<TArgs, TResult> => {
	const WrappedComponent: ToolCallMessagePartComponent<TArgs, TResult> = memo((props) => {
		return (
			<div className="flex flex-col gap-3">
				<BaseComponent {...props} />
				<ToolPermissionStack toolCallId={props.toolCallId} />
			</div>
		);
	});

	WrappedComponent.displayName = `withOpenCodeToolInteractions(${
		BaseComponent.displayName || BaseComponent.name || "Tool"
	})`;

	return WrappedComponent;
};

/**
 * Question tools surface as an activity subgroup ("Asking" / "Asked …").
 * The Questionnaire replaces the composer while pending — no tool-call chrome.
 */
export const AskQuestionTool: ToolCallMessagePartComponent = memo(() => null);
AskQuestionTool.displayName = "AskQuestionTool";
