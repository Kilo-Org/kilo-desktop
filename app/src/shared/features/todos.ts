import { z } from "zod";

import { defineMethod } from "../contract.js";

export const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

export type Todo = z.infer<typeof todoSchema>;

export const todoMethods = {
	"todos:list": defineMethod(z.undefined(), z.array(todoSchema)),
	"todos:add": defineMethod(z.object({ title: z.string().trim().min(1).max(120) }), todoSchema),
	"todos:toggle": defineMethod(z.object({ id: z.string().min(1) }), todoSchema),
} as const;
