import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2/client";

import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";

const ANACONDA_METADATA_KEY = "anaconda";

type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloGlobalConnection>;
	};
};

type ListedSession = {
	id: string;
	directory?: string | undefined;
	metadata?: unknown;
};

export type SessionUnscopeClient = {
	listSessions(): Promise<readonly ListedSession[]>;
	updateMetadata(input: {
		sessionID: string;
		directory?: string;
		metadata: Record<string, unknown>;
	}): Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Strips the deleted workspace stamp; keeps nested `anaconda` so the chat stays app-owned. */
export function unscopeAnacondaMetadata(
	metadata: unknown,
	workspaceId: string,
): Record<string, unknown> | null {
	const record = asRecord(metadata);
	const anaconda = asRecord(record?.[ANACONDA_METADATA_KEY]);
	if (!record || !anaconda || anaconda.workspaceId !== workspaceId) return null;
	const { workspaceId: _workspaceId, workspaceFolders: _folders, ...rest } = anaconda;
	return { ...record, [ANACONDA_METADATA_KEY]: rest };
}

export async function unscopeWorkspaceSessions(
	client: SessionUnscopeClient,
	workspaceId: string,
): Promise<void> {
	const sessions = await client.listSessions();
	await Promise.all(
		sessions.flatMap((session) => {
			const metadata = unscopeAnacondaMetadata(session.metadata, workspaceId);
			if (!metadata) return [];
			return [
				client.updateMetadata({
					sessionID: session.id,
					...(session.directory ? { directory: session.directory } : {}),
					metadata,
				}),
			];
		}),
	);
}

export function createKiloUnscopeClient(
	connection: KiloGlobalConnection,
	createClient: typeof createKiloClient = createKiloClient,
): SessionUnscopeClient {
	const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
		"base64",
	);
	const client: KiloClient = createClient({
		baseUrl: connection.baseUrl,
		headers: { Authorization: `Basic ${authorization}` },
	});
	return {
		async listSessions() {
			const response = await client.experimental.session.list(
				{ roots: true, archived: true },
				{ throwOnError: true },
			);
			return response.data ?? [];
		},
		async updateMetadata(input) {
			await client.session.update(
				{
					sessionID: input.sessionID,
					...(input.directory ? { directory: input.directory } : {}),
					metadata: input.metadata,
				},
				{ throwOnError: true },
			);
		},
	};
}

export function createWorkspaceSessionUnscoper(
	mainSdk: MainSdk,
	createClient: (
		connection: KiloGlobalConnection,
	) => SessionUnscopeClient = createKiloUnscopeClient,
): (workspaceId: string) => Promise<void> {
	return async (workspaceId) => {
		const connectionService =
			mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
		if (!connectionService) return;
		try {
			const connection = await connectionService.getConnection();
			await unscopeWorkspaceSessions(createClient(connection), workspaceId);
		} catch (error) {
			mainSdk.logger.warn("Could not clear workspace from chats after deleting a workspace.", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};
}
