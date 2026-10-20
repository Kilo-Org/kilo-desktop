import { useQuery } from "@tanstack/react-query";

import { useChatConnection } from "../connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras.js";
import type { PlanProjection } from "./plan-projection.js";

export type PlanContentState = {
	markdown: string;
	isLoading: boolean;
	isError: boolean;
};

/**
 * Prefer in-message projection markdown; when follow-up edits omit full content,
 * fall back to reading the plan file from disk.
 */
export function usePlanContent(projection: PlanProjection): PlanContentState {
	const { connectionPromise, isPending: isConnectionPending } = useChatConnection();
	const session = useOptionalOpenCodeRuntimeExtras()?.session;
	const sessionDirectory = session?.directory;
	const needsFile = Boolean(projection.path) && !projection.markdown;

	const contentQuery = useQuery({
		// Revisions share a path; keying by snapshot keeps one revision's file read from serving another.
		queryKey: [
			"kilo-ui",
			"plan-content",
			session?.id,
			sessionDirectory,
			projection.path,
			projection.anchorCallId,
		],
		enabled: needsFile && !isConnectionPending && Boolean(sessionDirectory),
		queryFn: async () => {
			if (!projection.path || !sessionDirectory) return "";
			const connection = await connectionPromise;
			const client = createKiloDirectoryClient(connection, sessionDirectory);
			const { data } = await client.file.read({ path: projection.path });
			return typeof data?.content === "string" ? data.content : "";
		},
		retry: false,
	});

	const markdown = projection.markdown || contentQuery.data || "";
	return {
		markdown,
		isLoading: needsFile && (isConnectionPending || !sessionDirectory || contentQuery.isPending),
		isError: needsFile && contentQuery.isError && !markdown,
	};
}
