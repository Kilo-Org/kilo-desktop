import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "../contract.js";

export const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

export type Todo = z.infer<typeof todoSchema>;

/** Shell LocalApi / DesktopApi channels (prefixed). */
export const todoMethods = {
	"todos:list": defineMethod(z.undefined(), z.array(todoSchema)),
	"todos:add": defineMethod(z.object({ title: z.string().trim().min(1).max(120) }), todoSchema),
	"todos:toggle": defineMethod(z.object({ id: z.string().min(1) }), todoSchema),
} as const;

/**
 * Feature-SDK contract (unprefixed; scoped by featureId).
 *
 * @example
 * const { client } = useSdk<TodoService>("todos");
 * const todo = await client.add({ title: "Buy milk" });
 */
export const todosContract = defineContract({
	list: defineMethod(z.undefined(), z.array(todoSchema)),
	add: defineMethod(z.object({ title: z.string().trim().min(1).max(120) }), todoSchema),
	toggle: defineMethod(z.object({ id: z.string().min(1) }), todoSchema),
});

/** Method-style service type inferred from the contract. */
export type TodoService = InferContract<typeof todosContract>;
