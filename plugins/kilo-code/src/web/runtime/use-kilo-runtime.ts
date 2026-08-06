import type { AssistantRuntime } from "@assistant-ui/react";
import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { useMemo } from "react";

import type { KiloWorkspaceConnection } from "../../contracts/schemas.js";
import { createKiloRuntimeClient } from "./create-kilo-runtime-client.js";

export interface UseKiloRuntimeOptions {
	connection: KiloWorkspaceConnection;
	initialSessionId?: string;
	defaultAgent?: string;
	defaultModel?: {
		providerID: string;
		modelID: string;
	};
	isSendDisabled?: boolean;
	onError?: (error: unknown) => void;
}

export function useKiloRuntime({
	connection,
	initialSessionId,
	defaultAgent,
	defaultModel,
	isSendDisabled,
	onError,
}: UseKiloRuntimeOptions): AssistantRuntime {
	const client = useMemo(
		() => createKiloRuntimeClient(connection),
		[connection.baseUrl, connection.directory, connection.username, connection.password],
	);

	return useOpenCodeRuntime({
		client,
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(defaultAgent === undefined ? {} : { defaultAgent }),
		...(defaultModel === undefined ? {} : { defaultModel }),
		...(isSendDisabled === undefined ? {} : { isSendDisabled }),
		...(onError === undefined ? {} : { onError }),
	});
}
