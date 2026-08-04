import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "../contract.js";

export const pingInput = z.undefined();
export const pingOutput = z.object({
	pong: z.literal(true),
	from: z.string(),
	producerNoteCount: z.number().int().nonnegative().nullable(),
});

/**
 * Feature-SDK contract for sdk-consumer. The ping result includes a value read
 * through mainSdk.plugins so the demo is a living main-side conformance check.
 */
export const sdkConsumerContract = defineContract({
	ping: defineMethod(pingInput, pingOutput),
});

export type SdkConsumerService = InferContract<typeof sdkConsumerContract>;
