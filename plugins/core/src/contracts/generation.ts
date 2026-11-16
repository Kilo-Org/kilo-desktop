import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

import { chatModelSchema } from "./chats";
import { modelRefSchema } from "./models";

export const generateInputSchema = z.object({
	/** The folder the agent reads the request in (its project). */
	directory: z.string().min(1),
	/** Names the throwaway chat while it exists. */
	title: z.string().trim().min(1).max(256),
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
		 * One structured answer: a throwaway chat that may use no tool but the
		 * structured-output sink (the prompt may carry untrusted content), is
		 * never listed, and is deleted afterwards. Resolves the answer object
		 * (shaped by `schema`, not checked against it).
		 */
		generate: method(generateInputSchema, z.record(z.string(), z.unknown())),
		/** A task-focused branch name for a chat's conversation; null while the task isn't clear yet. */
		generateBranchName: method(
			generateBranchNameInputSchema,
			z.object({ branch: z.string().nullable() }),
		),
	},
});
