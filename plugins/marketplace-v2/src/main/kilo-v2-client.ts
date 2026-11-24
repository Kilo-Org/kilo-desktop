import { OpenCode } from "@kilocode/client";
import { Definition as AgentRpc } from "@opencode/schema/kilocode/agent";
import { Definition as MarketplaceRpc } from "@opencode/schema/kilocode/marketplace";
import { Definition as SkillRpc } from "@opencode/schema/kilocode/skill";

import { MarketplaceBackendError, type V2MarketplaceApi } from "./kilo-v2-marketplace";

export type KiloConnection = {
	baseUrl: string;
	username: string;
	password: string;
	globalDirectory: string;
};

/** How long a location's plugins (which serve the RPCs) may take to load. */
const PLUGIN_WAIT_MS = 15_000;
const PLUGIN_POLL_MS = 100;

const errorType = (error: unknown) =>
	typeof error === "object" && error !== null ? (error as { type?: unknown }).type : undefined;

function toBackendError(error: unknown): unknown {
	if (typeof error !== "object" || error === null) return error;
	const { type, message } = error as { type?: unknown; message?: unknown };
	return typeof type === "string" && typeof message === "string"
		? new MarketplaceBackendError(message)
		: error;
}

/**
 * `V2MarketplaceApi` over Desktop's Kilo v2 server through `@kilocode/client`.
 * Plugin RPCs answer `rpc.unavailable` until the location's plugins load, so
 * those calls wait for them first; RPC failures become
 * `MarketplaceBackendError`s carrying Kilo's message.
 */
export function createKiloV2MarketplaceApi(
	connection: KiloConnection,
	fetch: typeof globalThis.fetch,
): V2MarketplaceApi {
	const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
		"base64",
	);
	const client = OpenCode.make({
		baseUrl: connection.baseUrl,
		headers: { authorization: `Basic ${authorization}` },
		fetch,
	} as Parameters<typeof OpenCode.make>[0]);
	const marketplace = client.rpc(MarketplaceRpc);
	const agentRpc = client.rpc(AgentRpc);
	const skillRpc = client.rpc(SkillRpc);
	const at = (directory: string) => ({ location: { directory } });

	async function rpc<T>(directory: string, call: (options: ReturnType<typeof at>) => Promise<T>) {
		const deadline = Date.now() + PLUGIN_WAIT_MS;
		const attempt = async (): Promise<T> => {
			try {
				return await call(at(directory));
			} catch (error) {
				if (errorType(error) !== "rpc.unavailable" || Date.now() > deadline) {
					throw toBackendError(error);
				}
				await new Promise((resolve) => setTimeout(resolve, PLUGIN_POLL_MS));
				return attempt();
			}
		};
		return attempt();
	}

	return {
		list: (kind, directory) => rpc(directory, (options) => marketplace.list({ kind }, options)),
		installed: (directory) => rpc(directory, (options) => marketplace.installed({}, options)),
		preview: (input, directory) => rpc(directory, (options) => marketplace.preview(input, options)),
		install: (input, directory) => rpc(directory, (options) => marketplace.install(input, options)),
		uninstall: async (input, directory) => {
			await rpc(directory, (options) => marketplace.uninstall(input, options));
		},
		agents: async (directory) => (await client.agent.list(at(directory))).data,
		removableAgents: (directory) => rpc(directory, (options) => agentRpc.removable({}, options)),
		removeAgent: async (name, scope, directory) => {
			await rpc(directory, (options) => agentRpc.remove({ name, scope }, options));
		},
		skills: async (directory) => (await client.skill.list(at(directory))).data,
		removableSkills: (directory) => rpc(directory, (options) => skillRpc.removable({}, options)),
		removeSkill: async (path, directory) => {
			await rpc(directory, (options) => skillRpc.remove({ path }, options));
		},
		mcpServers: async (directory) => (await client.mcp.list(at(directory))).data,
		oauthMethods: async (integrationID, directory) => {
			const { data } = await client.integration.get({ integrationID, ...at(directory) });
			return data.methods.flatMap((method) =>
				method.type === "oauth" && "id" in method ? [String(method.id)] : [],
			);
		},
		oauthConnect: async (integrationID, methodID, directory) => {
			const { data } = await client.integration.oauth.connect({
				integrationID,
				methodID,
				...at(directory),
			});
			return { attemptID: data.attemptID, url: data.url, expires: data.time.expires };
		},
		oauthStatus: async (integrationID, attemptID, directory) => {
			const { data } = await client.integration.oauth.status({
				integrationID,
				attemptID,
				...at(directory),
			});
			return data.status === "failed"
				? { status: "failed", message: data.message }
				: { status: data.status };
		},
	};
}
