import { describe, expect, it } from "vitest";

import { localConnectionExamples, localConnectionFields } from "./connection-display.js";

const info = {
	port: 44123,
	baseUrl: "http://127.0.0.1:44123/v1",
	apiKey: "secret",
};

describe("localConnectionFields", () => {
	it("lists the copyable base URL and API key", () => {
		expect(localConnectionFields(info)).toEqual([
			{
				id: "base-url",
				label: "Base URL",
				value: "http://127.0.0.1:44123/v1",
				masked: false,
			},
			{ id: "api-key", label: "API key", value: "secret", masked: true },
		]);
	});
});

describe("localConnectionExamples", () => {
	it("builds copyable curl for list-models, chat, and streaming chat", () => {
		expect(localConnectionExamples(info, "tiny-aaaa")).toEqual([
			{
				id: "models",
				label: "List models",
				method: "GET",
				url: "http://127.0.0.1:44123/v1/models",
				curl: "curl -sS 'http://127.0.0.1:44123/v1/models' -H 'Authorization: Bearer secret'",
				curlDisplay:
					"curl -sS 'http://127.0.0.1:44123/v1/models' -H 'Authorization: Bearer ••••••••'",
			},
			{
				id: "chat",
				label: "Chat completions",
				method: "POST",
				url: "http://127.0.0.1:44123/v1/chat/completions",
				curl: 'curl -sS -X POST \'http://127.0.0.1:44123/v1/chat/completions\' -H \'Authorization: Bearer secret\' -H \'Content-Type: application/json\' -d \'{"model":"tiny-aaaa","messages":[{"role":"user","content":"Hello!"}]}\'',
				curlDisplay:
					'curl -sS -X POST \'http://127.0.0.1:44123/v1/chat/completions\' -H \'Authorization: Bearer ••••••••\' -H \'Content-Type: application/json\' -d \'{"model":"tiny-aaaa","messages":[{"role":"user","content":"Hello!"}]}\'',
			},
			{
				id: "chat-stream",
				label: "Streaming completions",
				method: "POST",
				url: "http://127.0.0.1:44123/v1/chat/completions",
				curl: 'curl -N -sS -X POST \'http://127.0.0.1:44123/v1/chat/completions\' -H \'Authorization: Bearer secret\' -H \'Content-Type: application/json\' -d \'{"model":"tiny-aaaa","messages":[{"role":"user","content":"Hello!"}],"stream":true}\'',
				curlDisplay:
					'curl -N -sS -X POST \'http://127.0.0.1:44123/v1/chat/completions\' -H \'Authorization: Bearer ••••••••\' -H \'Content-Type: application/json\' -d \'{"model":"tiny-aaaa","messages":[{"role":"user","content":"Hello!"}],"stream":true}\'',
			},
		]);
	});
});
