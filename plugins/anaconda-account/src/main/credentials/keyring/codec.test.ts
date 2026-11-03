import { describe, it, expect } from "vitest";
import { decodeToken, encodeToken } from "./codec.js";
import { TokenPayloadParseError, TokenPayloadValidationError } from "../errors.js";
import type { TokenPayload } from "../types.js";

describe("decodeToken", () => {
	it("decodes a valid base64-encoded payload", () => {
		const payload: TokenPayload = {
			domain: "anaconda.com",
			api_key: "ak-123",
			username: "testuser",
			repo_tokens: [{ token: "rt-1", org_name: "org1" }],
			version: 2,
		};
		const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");

		const result = decodeToken(encoded);

		expect(result.domain).toBe("anaconda.com");
		expect(result.api_key).toBe("ak-123");
		expect(result.username).toBe("testuser");
		expect(result.repo_tokens).toEqual([{ token: "rt-1", org_name: "org1" }]);
		expect(result.version).toBe(2);
	});

	it("throws TokenPayloadParseError for invalid base64", () => {
		expect(() => decodeToken("not-valid-base64!!!")).toThrow(TokenPayloadParseError);
	});

	it("throws TokenPayloadValidationError for missing domain", () => {
		const encoded = Buffer.from(JSON.stringify({ api_key: "ak-123" })).toString("base64");

		expect(() => decodeToken(encoded)).toThrow(TokenPayloadValidationError);
	});

	it("accepts payload with only the required field (domain)", () => {
		const encoded = Buffer.from(JSON.stringify({ domain: "example.com" })).toString("base64");

		const result = decodeToken(encoded);

		expect(result.domain).toBe("example.com");
		expect(result.api_key).toBeUndefined();
		expect(result.repo_tokens).toBeUndefined();
	});
});

describe("encodeToken", () => {
	it("produces base64 that decodeToken can round-trip", () => {
		const payload: TokenPayload = {
			domain: "anaconda.com",
			api_key: "ak-456",
			username: "alice",
			repo_tokens: [{ token: "rt-2" }],
			version: 2,
		};

		const encoded = encodeToken(payload);
		const decoded = decodeToken(encoded);

		expect(decoded).toEqual(payload);
	});

	it("strips null and undefined values from output", () => {
		const payload: TokenPayload = {
			domain: "anaconda.com",
			api_key: null,
			username: undefined,
			repo_tokens: [],
			version: 2,
		};

		const encoded = encodeToken(payload);
		const json = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));

		expect(json).toEqual({ domain: "anaconda.com", repo_tokens: [], version: 2 });
		expect("api_key" in json).toBe(false);
		expect("username" in json).toBe(false);
	});
});
