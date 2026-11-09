import type { LocalConnectionInfo } from "../../contracts/schemas.js";

export interface LocalConnectionRequest {
	readonly id: "models" | "chat" | "chat-stream";
	readonly label: string;
	readonly method: "GET" | "POST";
	readonly url: string;
	readonly curl: string;
	readonly curlDisplay: string;
}

export const LOCAL_API_KEY_MASK = "••••••••";

export function localConnectionRequests(
	connection: LocalConnectionInfo,
	modelId = "model-id",
): readonly LocalConnectionRequest[] {
	const modelsUrl = `${connection.baseUrl}/models`;
	const chatUrl = `${connection.baseUrl}/chat/completions`;

	return [
		{
			id: "models",
			label: "List models",
			method: "GET",
			url: modelsUrl,
			curl: curlGet(modelsUrl, connection.apiKey),
			curlDisplay: curlGet(modelsUrl, LOCAL_API_KEY_MASK),
		},
		{
			id: "chat",
			label: "Chat completions",
			method: "POST",
			url: chatUrl,
			curl: curlChat(chatUrl, connection.apiKey, modelId),
			curlDisplay: curlChat(chatUrl, LOCAL_API_KEY_MASK, modelId),
		},
		{
			id: "chat-stream",
			label: "Streaming completions",
			method: "POST",
			url: chatUrl,
			curl: curlChat(chatUrl, connection.apiKey, modelId, true),
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
