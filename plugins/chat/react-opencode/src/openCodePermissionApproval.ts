import type { RespondToToolApprovalOptions, ToolCallMessagePart } from "@assistant-ui/react";
import type { OpenCodePermissionResponse, PermissionRequest } from "./types";

type ToolCallApproval = NonNullable<ToolCallMessagePart["approval"]>;

export const projectOpenCodePermissionApproval = (
	request: PermissionRequest,
): ToolCallApproval => ({
	id: request.id,
	options: [
		{
			id: "once",
			kind: "allow-once",
		},
		...(request.save && request.save.length > 0
			? [
					{
						id: "always",
						kind: "allow-always",
						description: "Allow these patterns from now on.",
						grants: [...request.save],
						confirm: true,
					},
				]
			: []),
		{
			id: "reject",
			kind: "reject-once",
		},
	],
});

export const projectResolvedOpenCodePermissionApproval = (entry: {
	request: PermissionRequest;
	reply: OpenCodePermissionResponse;
}): ToolCallApproval => ({
	id: entry.request.id,
	approved: entry.reply !== "reject",
	optionId: entry.reply,
});

export const toOpenCodePermissionResponse = ({
	approved,
	optionId,
}: RespondToToolApprovalOptions): OpenCodePermissionResponse => {
	if (optionId === undefined) return approved ? "once" : "reject";

	if (optionId === "once" || optionId === "always") {
		if (!approved) {
			throw new Error(`OpenCode permission option "${optionId}" must approve`);
		}
		return optionId;
	}

	if (optionId === "reject") {
		if (approved) {
			throw new Error('OpenCode permission option "reject" must reject');
		}
		return "reject";
	}

	throw new Error(`Unknown OpenCode permission option "${optionId}"`);
};
