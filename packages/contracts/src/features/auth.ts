import { z } from "zod";

import { defineEvent, defineMethod } from "../contract.js";

export const authUserSchema = z.object({
	userId: z.string().optional(),
	username: z.string().optional(),
	email: z.string().optional(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
});

export const authSessionSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("anonymous") }),
	z.object({ status: z.literal("authenticated"), user: authUserSchema }),
	z.object({ status: z.literal("error"), reason: z.string() }),
]);

export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;

export const authMethods = {
	"auth:get-session": defineMethod(z.undefined(), authSessionSchema),
	"auth:refresh": defineMethod(z.undefined(), authSessionSchema),
	"auth:login": defineMethod(z.undefined(), authSessionSchema),
	"auth:logout": defineMethod(z.undefined(), authSessionSchema),
} as const;

export const authEvents = {
	"auth:changed": defineEvent(authSessionSchema),
} as const;
