import { z } from "zod";

import { featureIdPattern } from "@kilo-desktop/feature-sdk";

import { defineMethod } from "../contract.js";

/**
 * Scoped filesystem channels backing `sdk.fs` (a capability boundary, not raw
 * fs). `featureId` selects the calling feature's private sandbox directory —
 * the Decision #20 storage root, `${userData}/plugins/<featureId>/` — and
 * `path` is always relative to it. The main-process service rejects absolute
 * paths, sandbox-escaping paths (`..`), and feature ids that are not plain
 * kebab-case, so no request can reach another feature's files or the host
 * filesystem.
 *
 * Note: features share one renderer process, so `featureId` is a convention
 * boundary (Decision #12), not proof of origin — the sandbox root guarantee
 * holds regardless.
 */
const scopedFsInputSchema = z.object({
	/** Kebab-case feature id — shared charset with the plugin manifest. */
	featureId: z.string().regex(featureIdPattern),
	/** Path relative to the feature's sandbox dir. */
	path: z.string(),
});

export const fsMethods = {
	"fs:read-file": defineMethod(scopedFsInputSchema, z.object({ content: z.string() })),
	"fs:write-file": defineMethod(scopedFsInputSchema.extend({ content: z.string() }), z.undefined()),
	"fs:exists": defineMethod(scopedFsInputSchema, z.object({ exists: z.boolean() })),
	"fs:mkdir": defineMethod(scopedFsInputSchema, z.undefined()),
	"fs:readdir": defineMethod(scopedFsInputSchema, z.object({ entries: z.array(z.string()) })),
	"fs:remove": defineMethod(scopedFsInputSchema, z.undefined()),
} as const;
