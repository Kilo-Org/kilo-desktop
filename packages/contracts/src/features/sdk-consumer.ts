import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "../contract.js";

export const pingInput = z.undefined();
export const pingOutput = z.object({
	pong: z.literal(true),
	from: z.string(),
});

/**
 * Feature-SDK contract for sdk-consumer (trivial ping for mainRegister).
 */
export const sdkConsumerContract = defineContract({
	ping: defineMethod(pingInput, pingOutput),
});

export type SdkConsumerService = InferContract<typeof sdkConsumerContract>;
