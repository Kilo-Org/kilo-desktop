import { useQuery } from "@tanstack/react-query";

import { useChatConnection } from "../connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
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
	const needsFile = Boolean(projection.path) && !projection.markdown;

	const contentQuery = useQuery({
		queryKey: ["kilo-ui", "plan-content", projection.path],
		enabled: needsFile && !isConnectionPending,
		queryFn: async () => {
			if (!projection.path) return "";
			const connection = await connectionPromise;
			const client = createKiloDirectoryClient(connection, connection.globalDirectory);
			const { data } = await client.file.read({ path: projection.path });
			return typeof data?.content === "string" ? data.content : "";
		},
		retry: false,
	});

	const markdown = projection.markdown || contentQuery.data || "";
	return {
		markdown,
		isLoading: needsFile && (isConnectionPending || contentQuery.isPending),
		isError: needsFile && contentQuery.isError && !markdown,
	};
}
