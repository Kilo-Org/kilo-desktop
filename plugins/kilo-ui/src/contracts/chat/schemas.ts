import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

import { workspaceFolderInputSchema } from "../workspaces/schemas.js";

export const kiloSessionPreparationInputSchema = z.object({
	workspaceId: z.string().min(1).optional(),
	/**
	 * Request a git worktree for the session instead of the workspace
	 * checkout: either create one (`baseBranch` picks what to base it on,
	 * omitted means the git plugin's default-branch chain) or reuse an
	 * already registered one (`existingDirectory`, re-validated fresh
	 * through the git plugin's `resolveWorktree` — the directory is never
	 * trusted blindly as the session directory). `existingDirectory` is
	 * `strictObject`-guarded so `{}` cannot ambiguously match both
	 * branches — callers check `"existingDirectory" in worktree`.
	 */
	worktree: z
		.union([
			z.strictObject({ baseBranch: z.string().min(1).max(255).optional() }),
			z.strictObject({ existingDirectory: z.string().min(1).max(32_768) }),
		])
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
	/** Present when this call produced a worktree for the session. */
	worktree: z
		.object({
			branch: z.string().min(1),
			/**
			 * True only when this very call created the worktree
			 * (`createWorktree`); false when it re-validated an existing one
			 * (`resolveWorktree`). Only a `created: true` worktree is removed
			 * by the failed-session cleanup — a reused worktree is the user's
			 * live checkout and must never be deleted.
			 */
			created: z.boolean(),
			/**
			 * Non-blocking degradation notice from the git plugin (e.g. the
			 * base fetch failed, so the branch was cut from local state).
			 */
			warning: z.string().min(1).optional(),
			/**
			 * The ref the branch was cut from (e.g. `origin/main`); absent
			 * when cut from HEAD. Forwarded to the branch namer so the
			 * idle-work probe compares against the worktree's real base
			 * instead of the repository's default branch.
			 */
			baseRef: z.string().min(1).max(512).optional(),
		})
		.optional(),
});

export const gatewayModelDetailsSchema = z.object({
	modelID: z.string().min(1),
	description: z.string().optional(),
	inputPricePerMillion: z.number().nonnegative().optional(),
	outputPricePerMillion: z.number().nonnegative().optional(),
	averageAttemptCostUsd: z.number().nonnegative().optional(),
	kiloBenchScore: z.number().min(0).max(1).optional(),
	codingIndex: z.number().nonnegative().optional(),
	codeModeRank: z.number().int().positive().optional(),
	enkryptRiskScore: z.number().min(0).max(100).optional(),
	contextWindow: z.number().int().positive().optional(),
	maxOutputTokens: z.number().int().positive().optional(),
	isFree: z.boolean().optional(),
	mayTrainOnYourPrompts: z.boolean().optional(),
	hasUserByokAvailable: z.boolean().optional(),
	modelPageSlug: z.string().min(1).optional(),
});

export const gatewayModelDetailsListSchema = z.array(gatewayModelDetailsSchema);

export type KiloGlobalConnection = z.infer<typeof kiloGlobalConnectionSchema>;
export type KiloSessionPreparation = z.infer<typeof kiloSessionPreparationSchema>;
export type GatewayModelDetails = z.infer<typeof gatewayModelDetailsSchema>;

export const kiloUiChatContract = defineContract({
	"chat.getConnection": defineMethod(z.undefined(), kiloGlobalConnectionSchema),
	"chat.getGatewayModelDetails": defineMethod(z.undefined(), gatewayModelDetailsListSchema),
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
			baseBranch: z.string().min(1).max(512).optional(),
		}),
		z.boolean(),
	),
	/**
	 * Best-effort: records a new worktree session for the VS Code Agent
	 * Manager, which otherwise lists Desktop worktrees with no sessions.
	 * Never fails the chat — git declines and errors are logged main-side.
	 */
	"chat.linkWorktreeSession": defineMethod(
		z.object({
			directory: z.string().min(1).max(32_768),
			sessionId: z
				.string()
				.min(1)
				.max(256)
				.regex(/^[A-Za-z0-9_-]+$/),
			baseRef: z.string().min(1).max(512).optional(),
		}),
		z.undefined(),
	),
});

export type KiloUiChatService = InferContract<typeof kiloUiChatContract>;
