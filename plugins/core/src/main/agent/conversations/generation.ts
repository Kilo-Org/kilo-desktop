import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { z } from "zod";

import { Generation } from "../../../contracts";
import type { ConversationsService } from "./index";
import { wireModel } from "./wire";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function serverCall<T>(label: string, call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		throw new KernelError("UNAVAILABLE", `Could not ${label}: ${errorText(error)}`);
	}
}

/** How many model replies one structured answer may take. */
const STRUCTURED_ATTEMPTS = 2;

/** The request with its answer's JSON schema written in: v2 prompts have no structured output. */
export function structuredPrompt(
	system: string,
	prompt: string,
	schema: Readonly<Record<string, unknown>>,
): string {
	return [
		system,
		prompt,
		"Reply with only a JSON object that matches this JSON Schema, with no other text and no code fence:",
		JSON.stringify(schema),
	]
		.filter((part) => part.length > 0)
		.join("\n\n");
}

/** The JSON object a reply holds, tolerating a code fence around it; undefined when none. */
export function readJsonObject(reply: string): Record<string, unknown> | undefined {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)?.[1];
	const text = (fenced ?? reply).trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end < start) return undefined;
	try {
		const value: unknown = JSON.parse(text.slice(start, end + 1));
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** A Kilo plugin RPC failure's error name (`no_changes`, `failed`), if it is one. */
function rpcErrorType(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const type = (error as { type?: unknown }).type;
	return typeof type === "string" ? type : undefined;
}

/**
 * `kilo.core/generation`: one-shot calls through the chats' server
 * connection. Nothing here creates a chat.
 *
 * - `generate` asks one stateless model reply (`experimental.generate.text`:
 *   no tools, so the untrusted content a prompt carries can't act), with the
 *   answer's JSON schema written into the prompt; the reply is checked
 *   against the schema and asked for once more when it doesn't match.
 * - `generateCommitMessage` is Kilo's own generator
 *   (`kilocode.commit-message.generate`), which reads the repository itself.
 * - `generateBranchName` is `kilocode.branch-name.generate` on the chat.
 */
export function provideGeneration(sdk: PluginSdk, chats: ConversationsService): void {
	sdk.domainObjects.provide(Generation, {
		initialState: {},
		methods: {
			generate: async ({ system, prompt, schema, model }) => {
				const { client } = await chats.connected();
				let answer: z.ZodType;
				try {
					answer = z.fromJSONSchema(schema as never);
				} catch (error) {
					throw new KernelError(
						"VALIDATION",
						`The answer's schema is unusable: ${errorText(error)}`,
					);
				}
				const request = structuredPrompt(system, prompt, schema);
				let problem = "The model did not return a structured answer.";
				// Each attempt only follows a failed one.
				for (let attempt = 0; attempt < STRUCTURED_ATTEMPTS; attempt++) {
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					const reply = await serverCall("get an answer", () =>
						client.generateText(request, model ? wireModel(model) : undefined),
					);
					const value = readJsonObject(reply);
					const checked = value ? answer.safeParse(value) : undefined;
					if (checked?.success) return value!;
					problem = checked
						? `The model's answer did not match the schema: ${checked.error.message}`
						: "The model did not return a structured answer.";
					sdk.logger.warn(`Structured answer rejected (attempt ${attempt + 1}): ${problem}`);
				}
				throw new KernelError("BUSINESS", problem);
			},
			generateCommitMessage: async ({ directory }) => {
				const { client } = await chats.connected();
				try {
					return { message: await client.generateCommitMessage(directory) };
				} catch (error) {
					const type = rpcErrorType(error);
					if (type === "no_changes") {
						throw new KernelError("BUSINESS", "There are no changes to describe.");
					}
					if (type === "failed") {
						throw new KernelError(
							"BUSINESS",
							`The model could not write a commit message: ${errorText(error)}`,
						);
					}
					throw new KernelError(
						"UNAVAILABLE",
						`Could not generate a commit message: ${errorText(error)}`,
					);
				}
			},
			generateBranchName: async ({ chatId, prompt, model }) => {
				const { client, directory } = await chats.chatClient(chatId);
				const branch = await serverCall("name the branch", () =>
					client.generateBranchName(directory, chatId, {
						prompt,
						...(model ? { providerID: model.aiProviderId, modelID: model.modelId } : {}),
					}),
				);
				return { branch };
			},
		},
	});
}
