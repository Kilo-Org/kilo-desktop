import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

import { chatModelSchema } from "./chats";
import { modelRefSchema } from "./models";

export const generateInputSchema = z.object({
	/** The folder the request is about (its project). */
	directory: z.string().min(1),
	/** What the request is for, as a label in logs. */
	title: z.string().trim().min(1).max(256),
	/** The instructions, sent ahead of `prompt`. */
	system: z.string().max(20_000),
	prompt: z.string().min(1).max(4_000_000),
	/** The JSON schema of the answer. */
	schema: z.record(z.string(), z.unknown()),
	/** The server's default model when absent. */
	model: chatModelSchema.optional(),
});
export type GenerateInput = z.input<typeof generateInputSchema>;

export const generateBranchNameInputSchema = z.object({
	chatId: z.string().min(1),
	/** The prompt that should shape the name; empty to name from the conversation so far. */
	prompt: z.string().max(100_000),
	/** The server's default model when absent. */
	model: modelRefSchema.optional(),
});
export type GenerateBranchNameInput = z.input<typeof generateBranchNameInputSchema>;

export const generateCommitMessageInputSchema = z.object({
	/** The repository root. */
	directory: z.string().min(1),
});
export type GenerateCommitMessageInput = z.input<typeof generateCommitMessageInputSchema>;

/**
 * One-shot structured calls to the agent: commit messages, pull request
 * text, branch names. Nothing here is listed as a chat.
 */
export const Generation = defineDomainObject({
	id: "kilo.core/generation",
	home: "main",
	description: "One-shot structured calls: commit messages, PR text, branch names.",
	state: z.object({}),
	methods: {
		/**
		 * One structured answer from a single model reply with no tools and no
		 * chat (the prompt may carry untrusted content). The schema is written
		 * into the prompt and the answer is checked against it, asking once more
		 * when it doesn't match. `BUSINESS` when no valid answer came back.
		 */
		generate: method(generateInputSchema, z.record(z.string(), z.unknown())),
		/**
		 * A commit message for the repository's staged changes, or every change
		 * when none are staged, by Kilo's commit message generator (its own model
		 * choice). `BUSINESS` when there is nothing to describe or the model failed.
		 */
		generateCommitMessage: method(
			generateCommitMessageInputSchema,
			z.object({ message: z.string() }),
		),
		/** A task-focused branch name for a chat's conversation; null while the task isn't clear yet. */
		generateBranchName: method(
			generateBranchNameInputSchema,
			z.object({ branch: z.string().nullable() }),
		),
	},
});
