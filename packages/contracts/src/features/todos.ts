import { z } from "zod";

import { defineIpcMethod } from "../contract.js";

export const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

export type Todo = z.infer<typeof todoSchema>;

/** Shell LocalApi / DesktopApi channels (prefixed). */
export const todoMethods = {
	"todos:list": defineIpcMethod(z.undefined(), z.array(todoSchema)),
	"todos:add": defineIpcMethod(z.object({ title: z.string().trim().min(1).max(120) }), todoSchema),
	"todos:toggle": defineIpcMethod(z.object({ id: z.string().min(1) }), todoSchema),
} as const;

/**
 * Feature-SDK channel map (unprefixed; scoped by featureId).
 * Use with `withChannels(useSdk("todos"), todosChannels)` and
 * `mainSdk.channels(todosChannels).handle("add", ...)`.
 */
export const todosChannels = {
	list: todoMethods["todos:list"],
	add: todoMethods["todos:add"],
	toggle: todoMethods["todos:toggle"],
} as const;
