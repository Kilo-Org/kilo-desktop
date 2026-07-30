import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "../contract.js";

// ─── Domain schemas ──────────────────────────────────────────────────────────

export const noteSchema = z.object({
	id: z.string(),
	text: z.string(),
	createdAt: z.number(),
});
export type Note = z.infer<typeof noteSchema>;

// ─── Channel input/output schemas (kept for call-site parsing if needed) ─────

export const listNotesInput = z.undefined();
export const listNotesOutput = z.array(noteSchema);

export const addNoteInput = z.object({ text: z.string().trim().min(1).max(500) });
export const addNoteOutput = noteSchema;

export const deleteNoteInput = z.object({ id: z.string().min(1) });
export const deleteNoteOutput = z.object({ deleted: z.boolean() });

export const clearNotesInput = z.undefined();
export const clearNotesOutput = z.object({ count: z.number() });

export const echoInput = z.object({ message: z.string() });
export const echoOutput = z.object({ echoed: z.string(), timestamp: z.number() });

/**
 * Feature-SDK contract for sdk-producer (unprefixed; scoped by featureId).
 *
 * @example
 * const { client } = useSdk<SdkProducerService>("sdk-producer");
 * const note = await client.add({ text: "hello" });
 */
export const sdkProducerContract = defineContract({
	list: defineMethod(listNotesInput, listNotesOutput),
	add: defineMethod(addNoteInput, addNoteOutput),
	delete: defineMethod(deleteNoteInput, deleteNoteOutput),
	clear: defineMethod(clearNotesInput, clearNotesOutput),
	echo: defineMethod(echoInput, echoOutput),
});

export type SdkProducerService = InferContract<typeof sdkProducerContract>;
