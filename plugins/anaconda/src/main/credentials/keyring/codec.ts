import { TokenPayloadParseError, TokenPayloadValidationError } from "../errors";
import type { TokenPayload } from "../types";
import { z } from "zod";

const repoTokenSchema = z.object({
	token: z.string(),
	org_name: z.string().nullish(),
});

const tokenPayloadSchema = z.object({
	domain: z.string().min(1),
	api_key: z.string().nullish(),
	username: z.string().nullish(),
	user_id: z.string().nullish(),
	repo_tokens: z.array(repoTokenSchema).nullish(),
	version: z.number().int().nullish(),
});

const omitNullish = (_key: string, value: unknown): unknown =>
	value === null || value === undefined ? undefined : value;

export function encodeToken(payload: TokenPayload): string {
	return Buffer.from(JSON.stringify(payload, omitNullish)).toString("base64");
}

export function decodeToken(encoded: string): TokenPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
	} catch (cause) {
		throw new TokenPayloadParseError(cause);
	}

	const result = tokenPayloadSchema.safeParse(parsed);
	if (!result.success) {
		throw new TokenPayloadValidationError(result.error.issues);
	}

	return result.data;
}
