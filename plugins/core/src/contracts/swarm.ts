import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

/**
 * Kilo Swarm: the shared agent board of a root chat and its subagents, and
 * the background subagent jobs it delegated. Kilo owns both; this is a
 * read-mostly view of them, keyed by any chat of the tree (Kilo routes it to
 * the board's owning root). Posting stays agent-to-agent: Kilo treats board
 * content as untrusted coordination data, so nothing here can post.
 */

export const BOARD_MESSAGE_TYPES = ["INFO", "ASK", "RESULT", "HOLD", "VETO"] as const;
export type BoardMessageType = (typeof BOARD_MESSAGE_TYPES)[number];

/** Addressed to every participant. */
export const BOARD_EVERYONE = "ALL";

export const boardMessageSchema = z.object({
	id: z.string(),
	timestamp: z.number(),
	/** The sender's chat id (`ses_…`), Kilo's name for the root (`main`), or `user` (the person, mirrored by Kilo). */
	from: z.string(),
	/** A chat id, `main`, or `ALL`. */
	to: z.string(),
	fromLabel: z.string().optional(),
	toLabel: z.string().optional(),
	type: z.enum(BOARD_MESSAGE_TYPES),
	body: z.string(),
	replyTo: z.string().optional(),
});
export type BoardMessage = z.output<typeof boardMessageSchema>;

export const swarmBoardSchema = z.object({
	/** The root chat owning the board. */
	ownerChatId: z.string(),
	/** Grows with every post (a reset clears up to it and keeps it); `reset` must name the one it saw. */
	revision: z.number(),
	/** Oldest first within the page. */
	messages: z.array(boardMessageSchema),
	/** Pass as `before` for the next older page. */
	cursor: z.string().optional(),
	hasMore: z.boolean(),
});
export type SwarmBoard = z.output<typeof swarmBoardSchema>;

export const BACKGROUND_JOB_STATUSES = ["running", "completed", "error", "cancelled"] as const;

export const backgroundJobSchema = z.object({
	id: z.string(),
	/** The kind of job (`task` for a subagent). */
	type: z.string(),
	title: z.string().optional(),
	status: z.enum(BACKGROUND_JOB_STATUSES),
	/** The job's own chat, when it runs in one. */
	chatId: z.string().optional(),
	/** The subagent's agent type (`explore`, `general`…), when Kilo says (typed from Kilo's K9a). */
	agent: z.string().optional(),
	/** The model the subagent runs on, `<aiProviderId>/<modelId>`, when Kilo says. */
	model: z.string().optional(),
	startedAt: z.number(),
	completedAt: z.number().optional(),
	error: z.string().optional(),
});
export type BackgroundJob = z.output<typeof backgroundJobSchema>;

export const TEAM_MEMBER_STATES = [
	"running",
	"busy",
	"retry",
	"offline",
	"completed",
	"error",
	"cancelled",
	"unknown",
] as const;

/** One worker of a root chat's team, from Kilo's roster. */
export const teamMemberSchema = z.object({
	chatId: z.string(),
	/** The chat that delegated it: the root, or another worker. */
	parentChatId: z.string(),
	/** Its agent type (`explore`, `general`…). */
	agent: z.string().optional(),
	title: z.string(),
	/** Where it works; another repository's folder for a worker in another workspace. */
	directory: z.string(),
	/** `running`/`busy`/`retry` while it works; `offline` when a restart cut it off. */
	state: z.enum(TEAM_MEMBER_STATES),
	/** It runs as a background job; absent when nothing says (after a restart). */
	background: z.boolean().optional(),
	/** A background job runs it in this server now (it can be stopped). */
	live: z.boolean(),
	/** It waits for the person: a question or a permission prompt. */
	attention: z.array(z.enum(["question", "permission"])),
	/** The model it runs on, `<aiProviderId>/<modelId>`. */
	model: z.string().optional(),
	variant: z.string().optional(),
	startedAt: z.number(),
	completedAt: z.number().optional(),
	error: z.string().optional(),
});
export type TeamMember = z.output<typeof teamMemberSchema>;

export const swarmTeamSchema = z.object({
	members: z.array(teamMemberSchema),
	/** Kilo returned only the first members. */
	truncated: z.boolean(),
});
export type SwarmTeam = z.output<typeof swarmTeamSchema>;

/** What a chat tree has spent, from Kilo's model usage. */
export const swarmUsageSchema = z.object({
	/** The whole tree's cost (USD): its top-level root chat and every subagent. */
	cost: z.number(),
	/** The cost of the asked chat's own subtree, when Kilo says. */
	ownCost: z.number().optional(),
	/** The whole tree's tokens; `input` leaves out cache reads and writes. */
	tokens: z.object({ input: z.number(), output: z.number() }),
});
export type SwarmUsage = z.output<typeof swarmUsageSchema>;

/** The most messages one `board` call returns. */
export const SWARM_BOARD_PAGE_LIMIT = 50;

const chatIdInput = z.object({ chatId: z.string().min(1) });

export const Swarm = defineDomainObject({
	id: "kilo.core/swarm",
	home: "main",
	description: "Kilo Swarm: a root chat's shared agent board and its background subagent jobs.",
	state: z.object({
		/**
		 * The running Kilo server announces board changes (`board.updated`), so a
		 * board view can stop polling. False on Kilo CLIs before Kilo Swarm's PR 1.
		 */
		boardEvents: z.boolean(),
		/** The running Kilo server has the team roster (`swarm.team`); `team` returns null without it. */
		team: z.boolean(),
		/**
		 * Delegated agents get a shared board: Kilo's `shared_agent_board` in the
		 * user's global config, on unless it is `false`. Null until it is read
		 * (when the server connects).
		 */
		enabled: z.boolean().nullable(),
	}),
	methods: {
		/** A page of the board, newest page first; `before` pages back. */
		board: method(
			chatIdInput.extend({
				before: z.string().min(1).optional(),
				limit: z.number().int().min(1).max(SWARM_BOARD_PAGE_LIMIT).optional(),
			}),
			swarmBoardSchema,
		),
		/**
		 * Clears the board's visible messages (conversations and running work
		 * are untouched). Throws `CONFLICT` when the board changed since
		 * `revision`: read it again before offering another reset.
		 */
		reset: method(chatIdInput.extend({ revision: z.number().int().min(0) }), swarmBoardSchema),
		/**
		 * The root chat's workers from Kilo's roster (state, agent, model,
		 * directory, what they wait for); null on Kilo CLIs without one.
		 */
		team: method(chatIdInput, swarmTeamSchema.nullable()),
		/** The background subagent jobs the chat delegated. */
		jobs: method(chatIdInput, z.array(backgroundJobSchema)),
		/** Cancels one background job and its chat tree. */
		cancelJob: method(chatIdInput.extend({ jobId: z.string().min(1) }), z.undefined()),
		/**
		 * Turns the shared board on or off for every chat by writing
		 * `shared_agent_board` into the user's global Kilo config, shared with the
		 * Kilo CLI and VS Code. Only kilo.core, kilo.chat and the main kernel may.
		 */
		setEnabled: method(z.object({ enabled: z.boolean() }), z.undefined()),
		/**
		 * What the chat's tree has spent (the whole tree, and the chat's own
		 * subtree); null on Kilo CLIs without model usage.
		 */
		usage: method(chatIdInput, swarmUsageSchema.nullable()),
	},
	events: {
		/** A root chat's board changed: a post, or a reset (`cleared` reaches `revision`). */
		"board-updated": z.object({
			/** The root chat owning the board. */
			chatId: z.string(),
			revision: z.number(),
			cleared: z.number(),
		}),
	},
});
