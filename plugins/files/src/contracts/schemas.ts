import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

const workspaceRequestSchema = z.object({
	workspaceDirectory: z.string().min(1).max(32_768),
});

const fileRequestSchema = workspaceRequestSchema.extend({
	relativePath: z.string().min(1).max(32_768),
});

export const filesListResultSchema = z.object({
	paths: z.array(z.string()),
	truncated: z.boolean(),
});

export const fileReadResultSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("text"),
		contents: z.string(),
		byteLength: z.number().int().nonnegative(),
		truncated: z.boolean(),
		revision: z.string().optional(),
	}),
	z.object({
		kind: z.literal("image"),
		mimeType: z.string(),
		base64: z.string(),
		byteLength: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("unsupported"),
		reason: z.enum(["binary", "too-large", "preview-deferred"]),
		byteLength: z.number().int().nonnegative(),
	}),
]);

export const fileWriteResultSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("saved"), revision: z.string() }),
	z.object({ status: z.literal("conflict"), diskRevision: z.string() }),
]);

export const filesContract = defineContract({
	list: defineMethod(workspaceRequestSchema, filesListResultSchema),
	read: defineMethod(fileRequestSchema, fileReadResultSchema),
	write: defineMethod(
		fileRequestSchema.extend({
			contents: z.string(),
			expectedRevision: z.string().regex(/^[a-f\d]{64}$/u),
			force: z.boolean().optional(),
		}),
		fileWriteResultSchema,
	),
});

export type FilesServiceContract = InferContract<typeof filesContract>;
export type FileReadResult = z.infer<typeof fileReadResultSchema>;
