import {
	OpenCode,
	type AgentInfo,
	type CommandInfo,
	type OpenCodeClient,
	type SessionMessageInfo,
	type SkillInfo,
} from "@kilocode/client";

/**
 * Kilo v2's client (`@kilocode/client`), and the few calls whose v2
 * behaviour every caller needs the same way:
 *
 * - A location starts on its first request and lists only some agents,
 *   commands and skills, or none, until its plugins register; they register
 *   together, so its lists are complete once its plugin inventory isn't
 *   empty. A server without the inventory fails that read: stop waiting.
 * - A history is read whole, oldest first, a page of `message.list` at a
 *   time: v2's markers early in a session (agent and model switches) set what
 *   the messages after them carry.
 * - System text for a turn goes in as a hidden note (`session.synthetic`)
 *   the turn reads, not as part of the prompt.
 */

export type KiloClient = OpenCodeClient;

/** A Kilo v2 client for a server. */
export function createKiloClient(config: {
	baseUrl: string;
	headers?: Record<string, string>;
	fetch?: typeof globalThis.fetch;
}): KiloClient {
	return OpenCode.make(config);
}

/** How long and how often a location's lists wait for its plugins, which provide them. */
const PLUGINS_WAIT_MS = 30_000;
const PLUGINS_POLL_MS = 100;

const at = (directory: string | undefined) => (directory ? { location: { directory } } : undefined);

/** Resolves once `directory`'s plugins have registered (or the server can't say). */
export async function pluginsRegistered(client: KiloClient, directory: string): Promise<void> {
	const deadline = Date.now() + PLUGINS_WAIT_MS;
	while (Date.now() < deadline) {
		const listed = await client.plugin.list(at(directory)).then(
			(result) => result.data.length > 0,
			() => true,
		);
		if (listed) return;
		await new Promise((resolve) => setTimeout(resolve, PLUGINS_POLL_MS));
	}
}

/** The agents `directory` offers, once its plugins have registered them. */
export async function listAgents(client: KiloClient, directory?: string): Promise<AgentInfo[]> {
	if (directory) await pluginsRegistered(client, directory);
	return (await client.agent.list(at(directory))).data;
}

/** The slash commands `directory` offers, once its plugins have registered them. */
export async function listCommands(client: KiloClient, directory?: string): Promise<CommandInfo[]> {
	if (directory) await pluginsRegistered(client, directory);
	return (await client.command.list(at(directory))).data;
}

/** The skills `directory` offers, once its plugins have registered them. */
export async function listSkills(client: KiloClient, directory?: string): Promise<SkillInfo[]> {
	if (directory) await pluginsRegistered(client, directory);
	return (await client.skill.list(at(directory))).data;
}

/** A command template's argument placeholders (`$1`, `$ARGUMENTS`), each once, in order of first use. */
export function commandHints(template: string | undefined): string[] {
	return [...new Set(template?.match(/\$(?:\d+|ARGUMENTS)/g) ?? [])];
}

/** A turn's system text as the hidden note that carries it. */
export const systemNote = (system: string) => `<system-reminder>\n${system}\n</system-reminder>`;

/** The largest page `message.list` takes; a history is read in pages of this size. */
export const OPEN_CODE_HISTORY_PAGE_SIZE = 200;

/** The `message.list` input for a page of a session's history, oldest first. */
export const historyPageInput = (sessionID: string, cursor?: string) => ({
	sessionID,
	order: "asc" as const,
	limit: OPEN_CODE_HISTORY_PAGE_SIZE,
	...(cursor ? { cursor } : {}),
});

/** A session's whole history, oldest first. */
export async function readHistory(
	client: KiloClient,
	sessionID: string,
): Promise<SessionMessageInfo[]> {
	const messages: SessionMessageInfo[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.message.list(historyPageInput(sessionID, cursor));
		messages.push(...page.data);
		cursor =
			page.data.length === OPEN_CODE_HISTORY_PAGE_SIZE
				? (page.cursor.next ?? undefined)
				: undefined;
	} while (cursor);
	return messages;
}

const ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let lastIdTime = 0;
let idCounter = 0;

/**
 * A new message id, as Kilo v2 mints them (`msg_` + an ascending id: time and
 * a counter, then random characters): a prompt sent with it is delivered under
 * it, so its pending copy is matched exactly.
 */
export function newMessageId(now = Date.now()): string {
	if (now !== lastIdTime) {
		lastIdTime = now;
		idCounter = 0;
	}
	idCounter += 1;
	const value = BigInt(now) * 0x1000n + BigInt(idCounter);
	const time = Array.from({ length: 6 }, (_, index) =>
		Number((value >> BigInt(40 - 8 * index)) & 0xffn)
			.toString(16)
			.padStart(2, "0"),
	).join("");
	const random = crypto.getRandomValues(new Uint8Array(14));
	return `msg_${time}${Array.from(random, (byte) => ID_CHARS[byte % 62]).join("")}`;
}
