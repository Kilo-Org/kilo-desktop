import type { LocalConnectionInfo } from "./contract.js";

export interface LocalConnectionField {
	readonly id: "base-url" | "api-key";
	readonly label: string;
	readonly value: string;
	readonly masked: boolean;
}

export interface LocalConnectionExample {
	readonly id: "models" | "chat" | "chat-stream";
	readonly label: string;
	readonly method: "GET" | "POST";
	readonly url: string;
	readonly curl: string;
	readonly curlDisplay: string;
}

export const LOCAL_API_KEY_MASK = "••••••••";

export function localConnectionFields(info: LocalConnectionInfo): readonly LocalConnectionField[] {
	return [
		{ id: "base-url", label: "Base URL", value: info.baseUrl, masked: false },
		{ id: "api-key", label: "API key", value: info.apiKey, masked: true },
	];
}

export function localConnectionExamples(
	info: LocalConnectionInfo,
	modelId = "model-id",
): readonly LocalConnectionExample[] {
	const modelsUrl = `${info.baseUrl}/models`;
	const chatUrl = `${info.baseUrl}/chat/completions`;
	return [
		{
			id: "models",
			label: "List models",
			method: "GET",
			url: modelsUrl,
			curl: curlGet(modelsUrl, info.apiKey),
			curlDisplay: curlGet(modelsUrl, LOCAL_API_KEY_MASK),
		},
		{
			id: "chat",
			label: "Chat completions",
			method: "POST",
			url: chatUrl,
			curl: curlChat(chatUrl, info.apiKey, modelId),
			curlDisplay: curlChat(chatUrl, LOCAL_API_KEY_MASK, modelId),
		},
		{
			id: "chat-stream",
			label: "Streaming completions",
			method: "POST",
			url: chatUrl,
			curl: curlChat(chatUrl, info.apiKey, modelId, true),
			curlDisplay: curlChat(chatUrl, LOCAL_API_KEY_MASK, modelId, true),
		},
	];
}

function shellWord(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function curlGet(url: string, apiKey: string): string {
	return ["curl -sS", shellWord(url), "-H", shellWord(`Authorization: Bearer ${apiKey}`)].join(" ");
}

function curlChat(url: string, apiKey: string, modelId: string, stream = false): string {
	const body = JSON.stringify({
		model: modelId,
		messages: [{ role: "user", content: "Hello!" }],
		...(stream ? { stream: true } : {}),
	});
	return [
		stream ? "curl -N -sS -X POST" : "curl -sS -X POST",
		shellWord(url),
		"-H",
		shellWord(`Authorization: Bearer ${apiKey}`),
		"-H",
		shellWord("Content-Type: application/json"),
		"-d",
		shellWord(body),
	].join(" ");
}
