import { useQuery } from "@tanstack/react-query";

import { useChatConnection } from "../runtime/chat-connection";
import { kiloClient } from "../runtime/kilo-client";
import { useOptionalOpenCodeSession } from "../runtime/use-optional-opencode-runtime-extras";
import type { PlanProjection } from "./plan-projection";

export type PlanContentState = {
	markdown: string;
	isLoading: boolean;
	isError: boolean;
};

/**
 * Prefers the markdown the plan's calls carry; when follow-up edits omit the
 * full content, reads the plan file through the chat's Kilo client.
 */
export function usePlanContent(projection: PlanProjection): PlanContentState {
	const { connection } = useChatConnection();
	const session = useOptionalOpenCodeSession();
	const directory = session?.directory;
	const needsFile = Boolean(projection.path) && !projection.markdown;

	const content = useQuery({
		// Revisions share a path; keying by revision keeps one's read from serving another.
		queryKey: [
			"kilo.chat",
			"plan-content",
			session?.id,
			directory,
			projection.path,
			projection.anchorCallId,
		],
		enabled: needsFile && Boolean(connection) && Boolean(directory),
		queryFn: async () => {
			const bytes = await kiloClient(connection!).file.read({
				path: projection.path,
				location: { directory: directory! },
			});
			return new TextDecoder().decode(bytes);
		},
		retry: false,
	});

	const markdown = projection.markdown || content.data || "";
	return {
		markdown,
		isLoading: needsFile && (!connection || !directory || content.isPending),
		isError: needsFile && content.isError && !markdown,
	};
}
