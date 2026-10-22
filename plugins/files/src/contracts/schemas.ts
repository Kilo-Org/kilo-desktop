import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

const workspaceRequestSchema = z.object({
	workspaceDirectory: z.string().min(1).max(32_768),
});

const fileRequestSchema = workspaceRequestSchema.extend({
	relativePath: z.string().min(1).max(32_768),
});

export const FILE_EXISTENCE_BATCH_LIMIT = 512;
export const FILE_LINK_MATCH_LIMIT = 50;

export const EXTERNAL_EDITORS = [
	{ id: "cursor", label: "Cursor", commands: ["cursor"] },
	{ id: "trae", label: "Trae", commands: ["trae"] },
	{ id: "kiro", label: "Kiro", commands: ["kiro"], baseArgs: ["ide"] },
	{ id: "vscode", label: "VS Code", commands: ["code"] },
	{ id: "vscode-insiders", label: "VS Code Insiders", commands: ["code-insiders"] },
	{ id: "vscodium", label: "VSCodium", commands: ["codium"] },
	{ id: "zed", label: "Zed", commands: ["zed", "zeditor"] },
	{ id: "antigravity", label: "Antigravity", commands: ["agy"] },
	{ id: "idea", label: "IntelliJ IDEA", commands: ["idea"] },
	{ id: "aqua", label: "Aqua", commands: ["aqua"] },
	{ id: "clion", label: "CLion", commands: ["clion"] },
	{ id: "datagrip", label: "DataGrip", commands: ["datagrip"] },
	{ id: "dataspell", label: "DataSpell", commands: ["dataspell"] },
	{ id: "goland", label: "GoLand", commands: ["goland"] },
	{ id: "phpstorm", label: "PhpStorm", commands: ["phpstorm"] },
	{ id: "pycharm", label: "PyCharm", commands: ["pycharm"] },
	{ id: "rider", label: "Rider", commands: ["rider"] },
	{ id: "rubymine", label: "RubyMine", commands: ["rubymine"] },
	{ id: "rustrover", label: "RustRover", commands: ["rustrover"] },
	{ id: "webstorm", label: "WebStorm", commands: ["webstorm"] },
] as const;

export const externalEditorIdSchema = z.enum(EXTERNAL_EDITORS.map(({ id }) => id));
export type ExternalEditorId = z.infer<typeof externalEditorIdSchema>;

export const filesListResultSchema = z.object({
	paths: z.array(z.string()),
	truncated: z.boolean(),
});

/**
 * Largest table file main will read and ship whole. Loads are all-or-error on
 * the renderer's main thread, so this bounds IPC payload and decode time; it
 * is not a Parquet or WASM limit. The renderer passes the same number to Sift
 * so a file main ships is never refused on arrival.
 */
export const TABLE_LIMIT_BYTES = 64 * 1024 * 1024;

export const binaryTableFormatSchema = z.enum(["parquet"]);
export type BinaryTableFormat = z.infer<typeof binaryTableFormatSchema>;

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
		kind: z.literal("table"),
		format: binaryTableFormatSchema,
		base64: z.string(),
		byteLength: z.number().int().nonnegative(),
		revision: z.string(),
	}),
	z.object({
		kind: z.literal("unsupported"),
		reason: z.enum(["binary", "too-large", "preview-deferred", "invalid-table"]),
		byteLength: z.number().int().nonnegative(),
	}),
]);

export const fileWriteResultSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("saved"), revision: z.string() }),
	z.object({ status: z.literal("conflict"), diskRevision: z.string() }),
]);

export const fileGitStatusSchema = z.enum(["added", "modified", "deleted", "renamed", "untracked"]);
export type FileGitStatus = z.infer<typeof fileGitStatusSchema>;

export const fileGitStatusEntrySchema = z.object({
	path: z.string(),
	status: fileGitStatusSchema,
});
export type FileGitStatusEntry = z.infer<typeof fileGitStatusEntrySchema>;

export const fileLinkResolutionSchema = z.object({
	kind: z.enum(["exact", "matches", "none"]),
	paths: z.array(z.string()).max(FILE_LINK_MATCH_LIMIT),
	truncated: z.boolean(),
});
export type FileLinkResolution = z.infer<typeof fileLinkResolutionSchema>;

export const filesContract = defineContract({
	list: defineMethod(workspaceRequestSchema, filesListResultSchema),
	resolveFileLink: defineMethod(fileRequestSchema, fileLinkResolutionSchema),
	existingPaths: defineMethod(
		workspaceRequestSchema.extend({
			relativePaths: z.array(z.string().min(1).max(32_768)).min(1).max(FILE_EXISTENCE_BATCH_LIMIT),
		}),
		z.object({ paths: z.array(z.string()) }),
	),
	read: defineMethod(fileRequestSchema, fileReadResultSchema),
	listExternalEditors: defineMethod(
		z.undefined(),
		z.object({ editors: z.array(externalEditorIdSchema) }),
	),
	openExternalEditor: defineMethod(
		fileRequestSchema.extend({ editor: externalEditorIdSchema }),
		z.object({ opened: z.literal(true) }),
	),
	write: defineMethod(
		fileRequestSchema.extend({
			contents: z.string(),
			expectedRevision: z.string().regex(/^[a-f\d]{64}$/u),
			force: z.boolean().optional(),
		}),
		fileWriteResultSchema,
	),
	gitStatus: defineMethod(
		workspaceRequestSchema,
		z.object({ entries: z.array(fileGitStatusEntrySchema) }).nullable(),
	),
});

export type FilesServiceContract = InferContract<typeof filesContract>;
export type FileReadResult = z.infer<typeof fileReadResultSchema>;
