import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

export const storedApiKeySchema = z.object({
	key: z.string().nullable(),
});

export type StoredApiKey = z.infer<typeof storedApiKeySchema>;

export const presentEnvSchema = z.object({
	names: z.array(z.string()),
});

export type PresentEnv = z.infer<typeof presentEnvSchema>;

export const kiloUiProvidersContract = defineContract({
	"providers.getApiKey": defineMethod(
		z.object({ providerID: z.string().min(1) }),
		storedApiKeySchema,
	),
	"providers.presentEnv": defineMethod(
		z.object({
			names: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(32),
		}),
		presentEnvSchema,
	),
});

export type KiloUiProvidersService = InferContract<typeof kiloUiProvidersContract>;
