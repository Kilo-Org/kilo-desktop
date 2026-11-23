import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";

import {
	BACKGROUND_JOB_STATUSES,
	BOARD_MESSAGE_TYPES,
	Swarm,
	TEAM_MEMBER_STATES,
	type SwarmTeam,
	type TeamMember,
	type BackgroundJob,
	type BoardMessage,
	type SwarmBoard,
	type SwarmUsage,
} from "../../../contracts";
import { onlyCallers } from "../callers";
import type { ConversationsService } from "../conversations";
import {
	BoardConflictError,
	type KiloBackgroundJob,
	type KiloBoard,
	type KiloChatClient,
	type KiloLastTurn,
	type KiloModelUsage,
	type KiloTeam,
} from "../conversations/kilo-chat-client";
import type { ChatInfo } from "../conversations/activity";

/** How deep and how many subchats the derived roster lists. */
const DERIVED_DEPTH = 4;
const DERIVED_LIMIT = 200;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isMessageType = (type: string): type is BoardMessage["type"] =>
	(BOARD_MESSAGE_TYPES as readonly string[]).includes(type);

const isJobStatus = (status: string): status is BackgroundJob["status"] =>
	(BACKGROUND_JOB_STATUSES as readonly string[]).includes(status);

/** Kilo sends unset times as JSON's non-finite stand-ins (`"NaN"`). */
const finite = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** Kilo's task metadata names the model as `{ providerID, modelID }` (or `id`). */
function modelOf(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { providerID, modelID, id } = value as Record<string, unknown>;
	const model = text(modelID) ?? text(id);
	return text(providerID) && model ? `${providerID as string}/${model}` : undefined;
}

/** Kilo's own switch for the shared board, in the user's global config. */
const BOARD_CONFIG_KEY = "shared_agent_board";

/** Kilo turns the board off only for an explicit `false` (its `BoardEnabled.resolve`). */
const boardEnabled = (config: Readonly<Record<string, unknown>>) =>
	config[BOARD_CONFIG_KEY] !== false;

/** It changes the user's own config, shared with the Kilo CLI and VS Code. */
const assertSettingCaller = onlyCallers(
	["kilo.chat"],
	"Only kilo.core and kilo.chat turn the shared agent board on or off.",
);

function toUsage(usage: KiloModelUsage): SwarmUsage {
	return {
		cost: usage.totals.cost,
		...(usage.sessionCost !== undefined ? { ownCost: usage.sessionCost } : {}),
		tokens: { input: usage.totals.tokens.input, output: usage.totals.tokens.output },
	};
}

const isMemberState = (state: string): state is TeamMember["state"] =>
	(TEAM_MEMBER_STATES as readonly string[]).includes(state);

function toTeam(team: KiloTeam): SwarmTeam {
	return {
		members: team.members.map((member) => ({
			chatId: member.sessionID,
			parentChatId: member.parentID,
			...(member.agent ? { agent: member.agent } : {}),
			title: member.title,
			directory: member.directory,
			state: isMemberState(member.state) ? member.state : "unknown",
			...(member.background !== undefined ? { background: member.background } : {}),
			live: member.live,
			attention: member.attention.filter(
				(kind): kind is "question" | "permission" => kind === "question" || kind === "permission",
			),
			...(member.model ? { model: `${member.model.providerID}/${member.model.modelID}` } : {}),
			...(member.model?.variant ? { variant: member.model.variant } : {}),
			startedAt: member.timeStarted,
			...(member.timeCompleted !== undefined ? { completedAt: member.timeCompleted } : {}),
			...(member.error ? { error: member.error } : {}),
		})),
		truncated: team.truncated,
	};
}

function toBoard(board: KiloBoard): SwarmBoard {
	return {
		ownerChatId: board.ownerSessionID,
		revision: board.revision,
		messages: board.messages.flatMap((message) => {
			if (!isMessageType(message.type)) return [];
			return [
				{
					id: message.id,
					timestamp: message.timestamp,
					from: message.from,
					to: message.to,
					...(message.fromLabel ? { fromLabel: message.fromLabel } : {}),
					...(message.toLabel ? { toLabel: message.toLabel } : {}),
					type: message.type,
					body: message.body,
					...(message.reply_to ? { replyTo: message.reply_to } : {}),
				},
			];
		}),
		...(board.cursor ? { cursor: board.cursor } : {}),
		hasMore: board.hasMore,
	};
}

function toJob(job: KiloBackgroundJob): BackgroundJob[] {
	if (!isJobStatus(job.status)) return [];
	const chatId = text(job.metadata?.sessionId);
	const agent = text(job.metadata?.agent) ?? text(job.metadata?.subagent_type);
	const model = modelOf(job.metadata?.model);
	const completedAt = finite(job.completed_at);
	return [
		{
			id: job.id,
			type: job.type,
			...(job.title ? { title: job.title } : {}),
			status: job.status,
			...(chatId ? { chatId } : {}),
			...(agent ? { agent } : {}),
			...(model ? { model } : {}),
			startedAt: finite(job.started_at) ?? 0,
			...(completedAt !== undefined ? { completedAt } : {}),
			...(job.error ? { error: job.error } : {}),
		},
	];
}

/**
 * The `kilo.core/swarm` domain object: Kilo Swarm's board and background
 * jobs, read and changed through the server in the chat's own directory (the
 * one its project lives in, which Kilo routes to the board's owning root).
 * It keeps no board state (Kilo owns the board); it relays Kilo's
 * `board.updated` as `board-updated` and says whether the server sends it
 * (`swarm.boardEvents` capability), so a board view polls only on older Kilo CLIs.
 * The team comes from Kilo's roster when the server has one (`swarm.team`).
 * `usage` relays Kilo's model usage of the chat's tree.
 *
 * Whether agents get a board at all is Kilo's own `shared_agent_board` in the
 * user's global config (`enabled`), read whenever a server (re)connects and
 * after every write. `setEnabled` writes it through the running server (the
 * one `kilo.core/server` connects), one write at a time, and only for
 * kilo.core, kilo.chat and the main kernel: the config is shared with the
 * Kilo CLI and VS Code. Unlike kilo.core/work-style it doesn't dispose the
 * server's instances afterwards: Kilo's `global.config.update` already
 * disposes them all when the file changed, so they reload the config and the
 * next agent turn sees the new value; a second dispose would only tear them
 * down twice.
 */
export function provideSwarm(sdk: PluginSdk, conversations: ConversationsService): void {
	/** Mirrors `swarm.state.team`, read before the domain object exists. */
	const rosterServed = { value: false };

	async function call<T>(
		chatId: string,
		label: string,
		run: (client: KiloChatClient, directory: string) => Promise<T>,
	): Promise<T> {
		const { client, directory } = await conversations.chatClient(chatId);
		try {
			return await run(client, directory);
		} catch (error) {
			if (error instanceof KernelError) throw error;
			if (error instanceof BoardConflictError) {
				throw new KernelError("CONFLICT", "The board changed. Read it again before clearing it.");
			}
			throw new KernelError("UNAVAILABLE", `Could not ${label}: ${errorText(error)}`);
		}
	}

	let writingSetting: Promise<unknown> = Promise.resolve();

	const swarm = sdk.domainObjects.provide(Swarm, {
		initialState: { boardEvents: false, team: false, enabled: null },
		methods: {
			board: ({ chatId, before, limit }) =>
				call(chatId, "read the board", async (client, directory) =>
					toBoard(await client.board(directory, chatId, { before, limit })),
				),
			reset: ({ chatId, revision }) =>
				call(chatId, "clear the board", async (client, directory) =>
					toBoard(await client.resetBoard(directory, chatId, revision)),
				),
			team: ({ chatId }) =>
				call(chatId, "read the team", async (client, directory): Promise<SwarmTeam> => {
					const served: KiloTeam | null = rosterServed.value
						? await client.team(directory, chatId)
						: null;
					return toTeam(served ?? (await derivedTeam(client, directory, chatId)));
				}),
			jobs: ({ chatId }) =>
				call(chatId, "read the background jobs", async (client, directory) =>
					(await client.backgroundJobs(directory, chatId)).flatMap(toJob),
				),
			cancelJob: ({ chatId, jobId }) =>
				call(chatId, "cancel the background job", (client, directory) =>
					client.cancelBackgroundJob(directory, jobId),
				),
			usage: ({ chatId }) =>
				call(chatId, "read the usage", async (client, directory) => {
					const usage = await client.usage(directory, chatId);
					return usage ? toUsage(usage) : null;
				}),
			setEnabled: ({ enabled }, caller) => {
				assertSettingCaller(caller);
				const run = writingSetting.then(async () => {
					const { client } = await conversations.connected();
					await client.updateGlobalConfig({ [BOARD_CONFIG_KEY]: enabled }).catch(explainFailure);
					await readEnabled();
				});
				writingSetting = run.catch(() => undefined);
				return run;
			},
		},
	});

	/** Kilo's own message (a read-only config, say) is what the person needs to fix it. */
	function explainFailure(error: unknown): never {
		sdk.logger.warn("Could not save the shared agent board setting", error);
		if (error instanceof KernelError) throw error;
		const message = error instanceof Error && error.message ? error.message : undefined;
		throw new KernelError("BUSINESS", message ?? "Could not save the shared agent board setting.", {
			cause: error,
		});
	}

	/** Reads `shared_agent_board` from the user's global config; failures leave `enabled` as it was. */
	async function readEnabled(): Promise<void> {
		try {
			const { client } = await conversations.connected();
			const enabled = boardEnabled(await client.globalConfig());
			if (enabled !== swarm.state.enabled) swarm.setState({ ...swarm.state, enabled });
		} catch (error) {
			sdk.logger.warn("Could not read the shared agent board setting", error);
		}
	}

	/**
	 * Workers' newest turns, kept while their chat is unchanged. A completed
	 * turn alone doesn't mean the worker settled: each step of a working
	 * agent completes its own message, so a turn read mid-run would date
	 * the finish minutes early if it were kept past the chat's next update.
	 */
	const turnCache = new Map<string, { readonly updatedAt: number; readonly turn: KiloLastTurn }>();

	/**
	 * The roster from what every Kilo server has, for those without Kilo's
	 * own (`swarm.team`): the root's subchats (depth first, a few levels),
	 * the server's statuses and pending prompts, and each worker's newest
	 * message. kilo.core lists only root chats and learns subchats from live
	 * events, so after a restart this is the only place the team comes from.
	 */
	async function derivedTeam(
		client: KiloChatClient,
		directory: string,
		rootChatId: string,
	): Promise<KiloTeam> {
		const workers: ChatInfo[] = [];
		let generation = [rootChatId];
		for (let depth = 0; depth < DERIVED_DEPTH && generation.length > 0; depth += 1) {
			const found = (
				await Promise.all(generation.map((id) => client.childChats(directory, id).catch(() => [])))
			).flat();
			workers.push(...found);
			generation = found.map((chat) => chat.id);
			if (workers.length >= DERIVED_LIMIT) break;
		}
		const [statuses, permissions, questions] = await Promise.all([
			client.statuses(directory).catch(() => ({}) as Record<string, { type: string }>),
			client.pendingPermissions(directory).catch(() => []),
			client.pendingQuestions(directory).catch(() => []),
		]);
		const listed = workers.slice(0, DERIVED_LIMIT);
		const turns = await Promise.all(
			listed.map(async (chat) => {
				const cached = turnCache.get(chat.id);
				if (cached?.updatedAt === chat.updatedAt) return cached.turn;
				const turn = await client.lastTurn(directory, chat.id).catch(() => null);
				if (turn) turnCache.set(chat.id, { updatedAt: chat.updatedAt, turn });
				return turn;
			}),
		);
		return {
			enabled: true,
			truncated: workers.length > DERIVED_LIMIT,
			members: listed.map((chat, index) => {
				const turn = turns[index];
				const status = statuses[chat.id]?.type;
				const state =
					status === "busy" || status === "retry"
						? status
						: !turn
							? "unknown"
							: turn.errorName === "MessageAbortedError"
								? "cancelled"
								: turn.errorName
									? "error"
									: turn.completedAt !== undefined
										? "completed"
										: "offline";
				const attention = [
					...(permissions.some((request) => request.sessionID === chat.id) ? ["permission"] : []),
					...(questions.some((request) => request.sessionID === chat.id) ? ["question"] : []),
				];
				return {
					sessionID: chat.id,
					parentID: chat.parentId ?? rootChatId,
					agent: chat.agent ?? "",
					title: chat.title,
					directory: chat.directory ?? directory,
					state,
					live: false,
					attention,
					...(turn?.model ? { model: turn.model } : {}),
					timeStarted: chat.createdAt,
					...(turn?.completedAt !== undefined ? { timeCompleted: turn.completedAt } : {}),
					...(turn?.errorMessage ? { error: turn.errorMessage } : {}),
				};
			}),
		};
	}

	/** Which Kilo Swarm milestones this server has; read again whenever a server (re)connects. */
	async function readCapabilities(): Promise<void> {
		try {
			const { client } = await conversations.connected();
			const capabilities = await client.capabilities();
			const flags = (capabilities.swarm ?? {}) as { boardEvents?: unknown; team?: unknown };
			const next = { boardEvents: flags.boardEvents === true, team: flags.team === true };
			rosterServed.value = next.team;
			if (next.boardEvents !== swarm.state.boardEvents || next.team !== swarm.state.team) {
				swarm.setState({ ...swarm.state, ...next });
			}
		} catch (error) {
			sdk.logger.warn("Could not read the Kilo server's capabilities", error);
		}
	}

	const stop = conversations.onEvent((event) => {
		if (event.type === "server.connected") {
			void readCapabilities();
			void readEnabled();
			return;
		}
		if (event.type !== "board.updated") return;
		const { sessionID, revision, cleared } = event.properties;
		if (typeof sessionID !== "string" || typeof revision !== "number") return;
		swarm.emit("board-updated", {
			chatId: sessionID,
			revision,
			cleared: typeof cleared === "number" ? cleared : 0,
		});
	});
	sdk.onDispose(stop);
}
