import { z } from "zod";

import { defineDomainObject, defineObjectType, method } from "@kilo-desktop/kernel";
import { chatModelSchema, chatSummarySchema } from "@kilo-desktop/plugin-core/contracts";

/** One work session, resolved by `kilo.work-sessions/work-sessions`; keyed by its id. */
export const WorkSessionObjectType = defineObjectType({
	id: "kilo.work-sessions/work-session",
	description:
		"A work session: a workspace, where it works and the chats it holds, keyed by its id.",
});

/** The title of a work session nobody has named and no chat has titled yet. */
export const DEFAULT_WORK_SESSION_TITLE = "New session";

/**
 * The title a work session gets when it is created, before any chat titles
 * it: "New session - <ISO time>", as Kilo titles a new chat, so a session
 * started without the agent reads like one started with it.
 */
export function defaultWorkSessionTitle(createdAt: number): string {
	return `${DEFAULT_WORK_SESSION_TITLE} - ${new Date(createdAt).toISOString()}`;
}

/**
 * How a work session is isolated: the workspace's own checkout, a new copy
 * the `vcs` contribution made for it, or an existing copy it picked.
 */
export const WORK_SESSION_ISOLATION_KINDS = ["local", "new-copy", "existing-copy"] as const;
export type WorkSessionIsolationKind = (typeof WORK_SESSION_ISOLATION_KINDS)[number];

export const workSessionSchema = z.object({
	/** `wses_…` — never a chat id. */
	id: z.string(),
	title: z.string(),
	/** Where the title came from: still the default, its first chat, or the person. */
	titleSource: z.enum(["default", "chat", "user"]),
	pinned: z.boolean(),
	archived: z.boolean(),
	/**
	 * When the archived state last changed (ms). A chat archived on the server
	 * after this archives the work session; the person's later choice wins. 0
	 * for a work session adopted from origin that no one has archived or
	 * restored here yet.
	 */
	archiveChangedAt: z.number(),
	workspaceId: z.string().nullable(),
	/** The copy's branch (`kilo/…`) when the work session runs in an isolated copy. */
	branch: z.string().nullable(),
	/** Where its chats run: its copy, or the workspace's primary folder. */
	directory: z.string().nullable(),
	/** Kilo chat (`ses_…`) ids, oldest first, from the chats' `workSessionId` stamp. */
	chatIds: z.array(z.string()),
	createdAt: z.number(),
	updatedAt: z.number(),
	/**
	 * How the work session was isolated when it was created. Absent for work
	 * sessions adopted from chats, whose directory and branch follow their chats.
	 */
	isolation: z.enum(WORK_SESSION_ISOLATION_KINDS).optional(),
	/** The ref a created copy's branch was cut from. */
	baseRef: z.string().optional(),
	/** True when kilo.work-sessions created the copy (not one picked from existing ones). */
	copyCreated: z.boolean().optional(),
});
export type WorkSession = z.output<typeof workSessionSchema>;

/**
 * Where a new work session works: the workspace's own checkout, a new copy
 * cut from `baseBranch` (default: the default branch), or an existing copy.
 * Without a `vcs` contribution only `local` is possible.
 */
export const workSessionIsolationSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("local") }),
	z.object({ kind: z.literal("new-copy"), baseBranch: z.string().min(1).optional() }),
	z.object({ kind: z.literal("existing-copy"), directory: z.string().min(1) }),
]);
export type WorkSessionIsolation = z.output<typeof workSessionIsolationSchema>;

export const isolationOptionsSchema = z.object({
	/** The workspace's primary folder. */
	directory: z.string(),
	currentBranch: z.string().nullable(),
	defaultBranch: z.string().nullable(),
	/** Local branches, then remote-tracking ones; empty for a repository without commits. */
	branches: z.array(
		z.object({
			name: z.string(),
			kind: z.enum(["local", "remote"]),
			ref: z.string(),
			upstream: z.string().nullable(),
		}),
	),
	recentBranches: z.array(z.string()),
	/** The repository's other copies inside workspace folders. */
	copies: z.array(z.object({ directory: z.string(), name: z.string(), branch: z.string() })),
});
export type IsolationOptions = z.output<typeof isolationOptionsSchema>;

/**
 * True when the work session runs in a copy no other work session shares,
 * so deleting it may offer to remove the copy.
 */
export function isOrphanedCopySession(workSessions: readonly WorkSession[], id: string): boolean {
	const own = workSessions.find((workSession) => workSession.id === id);
	if (!own?.branch || !own.directory) return false;
	return workSessions.every((other) => other.id === id || other.directory !== own.directory);
}

const workSessionIdInput = z.object({ id: z.string().min(1) });

export const workSessionsStateSchema = z.object({ workSessions: z.array(workSessionSchema) });
export type WorkSessionsState = z.output<typeof workSessionsStateSchema>;

/**
 * Every work session, shared by every window. A work session holds the Kilo
 * chats stamped with its id (`kilo.core/chats`); its title follows its first
 * chat's until the person renames it, and archiving follows its chats.
 */
export const WorkSessions = defineDomainObject({
	id: "kilo.work-sessions/work-sessions",
	home: "main",
	description:
		"Every work session: create, rename, pin, archive and delete, and the chats it holds.",
	state: workSessionsStateSchema,
	lookup: (state, id) => state.workSessions.find((workSession) => workSession.id === id),
	objectType: WorkSessionObjectType,
	methods: {
		/**
		 * Creates a work session. With `isolation` it is placed now: a copy is
		 * created or resolved in the workspace's repository by the `vcs`
		 * contribution (one it created is removed again when the work session
		 * can't be created).
		 */
		create: method(
			z.object({
				workspaceId: z.string().nullable().optional(),
				title: z.string().optional(),
				isolation: workSessionIsolationSchema.optional(),
			}),
			workSessionSchema,
		),
		/**
		 * Creates a Kilo chat in the work session (`kilo.core/chats`), stamped
		 * with its id, workspace, folders and branch, in its directory. Fails
		 * without kilo.core's chats.
		 */
		createChat: method(
			workSessionIdInput.extend({
				agent: z.string().min(1).optional(),
				model: chatModelSchema.optional(),
				title: z.string().trim().min(1).optional(),
			}),
			chatSummarySchema,
		),
		/**
		 * Forks one of the work session's chats at a user message
		 * (`kilo.core/chats` `fork`): a new chat in the same work session and
		 * directory, listed in it before this resolves. `NOT_FOUND` when the
		 * chat isn't the work session's.
		 */
		forkChat: method(
			workSessionIdInput.extend({
				chatId: z.string().min(1),
				messageId: z.string().min(1),
			}),
			chatSummarySchema,
		),
		rename: method(
			workSessionIdInput.extend({ title: z.string().trim().min(1) }),
			workSessionSchema,
		),
		setPinned: method(workSessionIdInput.extend({ pinned: z.boolean() }), workSessionSchema),
		setArchived: method(workSessionIdInput.extend({ archived: z.boolean() }), workSessionSchema),
		/**
		 * Records that the work session's copy branch was renamed (its chats'
		 * stamps are rewritten too). Fails for a work session without a copy.
		 */
		setBranch: method(workSessionIdInput.extend({ branch: z.string().min(1) }), workSessionSchema),
		/**
		 * Deletes the work session and (best effort) its chats on the Kilo
		 * server. `removeCopy` then removes its copy when no other work session
		 * shares it, after releasing the directory's Kilo instance; a removal
		 * that fails is reported in `copyError`, the work session staying deleted.
		 */
		remove: method(
			workSessionIdInput.extend({ removeCopy: z.boolean().optional() }),
			z.object({
				deleted: z.boolean(),
				copyRemoved: z.boolean().optional(),
				copyError: z.string().optional(),
			}),
		),
		/**
		 * What a new work session in the workspace can be isolated in: its
		 * branches and existing copies. Null without a `vcs` contribution or a
		 * repository.
		 */
		isolationOptions: method(
			z.object({ workspaceId: z.string().min(1) }),
			isolationOptionsSchema.nullable(),
		),
	},
	events: {
		created: z.object({ workSession: workSessionSchema }),
		updated: z.object({ before: workSessionSchema, after: workSessionSchema }),
		deleted: z.object({ workSession: workSessionSchema }),
	},
});
