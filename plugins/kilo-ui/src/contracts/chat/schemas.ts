import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

import { workspaceFolderInputSchema } from "../workspaces/schemas.js";

export const kiloSessionPreparationInputSchema = z.object({
	workspaceId: z.string().min(1).optional(),
	/**
	 * Request a git worktree for the session instead of the workspace
	 * checkout. `baseBranch` is the branch to base it on — omitted means
	 * the git plugin's default-branch chain.
	 */
	worktree: z
		.object({
			baseBranch: z.string().min(1).max(255).optional(),
		})
		.optional(),
});

export const kiloGlobalConnectionSchema = z.object({
	baseUrl: z.url(),
	username: z.string().min(1),
	password: z.string().min(1),
	version: z.string().min(1),
	globalDirectory: z.string().min(1),
});

export const kiloSessionPreparationSchema = z.object({
	directory: z.string().min(1),
	workspaceId: z.string().min(1).optional(),
	/**
	 * Worktree sessions re-root the primary folder at the worktree
	 * directory (the original checkout is dropped); non-primary folders
	 * pass through unchanged.
	 */
	workspaceFolders: z.array(workspaceFolderInputSchema),
	/** Present when a worktree was created for this session. */
	worktree: z
		.object({
			branch: z.string().min(1),
			/**
			 * Non-blocking degradation notice from the git plugin (e.g. the
			 * base fetch failed, so the branch was cut from local state).
			 */
			warning: z.string().min(1).optional(),
		})
		.optional(),
});

export type KiloGlobalConnection = z.infer<typeof kiloGlobalConnectionSchema>;
export type KiloSessionPreparation = z.infer<typeof kiloSessionPreparationSchema>;

export const kiloUiChatContract = defineContract({
	"chat.getConnection": defineMethod(z.undefined(), kiloGlobalConnectionSchema),
	"chat.prepareSession": defineMethod(
		kiloSessionPreparationInputSchema,
		kiloSessionPreparationSchema,
	),
	/**
	 * Best-effort semantic rename of a worktree session's branch (the git
	 * plugin declines with `null` when its guards reject the rename; a
	 * missing git capability also yields `null` — rename never errors the
	 * chat).
	 */
	"chat.renameWorktreeBranch": defineMethod(
		z.object({
			directory: z.string().min(1).max(32_768),
			currentBranch: z.string().min(1).max(255),
			requestedBranch: z.string().min(1).max(255),
		}),
		z.object({ branch: z.string() }).nullable(),
	),
	/**
	 * Remove a Kilo-managed worktree directory (and its `kilo/` branch).
	 * Idempotent in the git plugin; a missing git capability is an error —
	 * callers chose to delete user data and must not be silently fooled.
	 */
	"chat.removeWorktree": defineMethod(
		z.object({
			directory: z.string().min(1).max(32_768),
		}),
		z.undefined(),
	),
	/**
	 * Best-effort check whether a worktree session has actual file changes
	 * or commits ahead of the base. Used by the branch namer to gate idle-path
	 * generation on real work. Returns `false` on any failure (including a
	 * missing git capability) — absence of evidence is not generation.
	 */
	"chat.hasWorktreeWork": defineMethod(
		z.object({
			directory: z.string().min(1).max(32_768),
			baseBranch: z.string().min(1).max(255).optional(),
		}),
		z.boolean(),
	),
});

export type KiloUiChatService = InferContract<typeof kiloUiChatContract>;
