import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";

import { Generation } from "../../../contracts";
import type { ConversationsService } from "./index";
import { generateStructured, StructuredAnswerError } from "./structured-generation";
import { wireModel } from "./wire";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function serverCall<T>(label: string, call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		throw new KernelError("UNAVAILABLE", `Could not ${label}: ${errorText(error)}`);
	}
}

/**
 * `kilo.core/generation`: one-shot structured calls through the chats'
 * server connection. On Kilo v2 an answer is a plain completion with no chat
 * and no tools (`structured-generation.ts`), so the contract's `directory`
 * and `title` go unused; a branch name comes from the chat's location.
 */
export function provideGeneration(sdk: PluginSdk, chats: ConversationsService): void {
	sdk.domainObjects.provide(Generation, {
		initialState: {},
		methods: {
			generate: async ({ system, prompt, schema, model }) => {
				const { client } = await chats.connected();
				const complete = (text: string) =>
					serverCall("get an answer", () =>
						client.generateText({
							prompt: text,
							...(model
								? {
										model: {
											...wireModel(model),
											...(model.variant ? { variant: model.variant } : {}),
										},
									}
								: {}),
						}),
					);
				try {
					return await generateStructured(complete, { system, text: prompt, schema });
				} catch (error) {
					if (error instanceof StructuredAnswerError) {
						throw new KernelError("BUSINESS", error.message);
					}
					throw error;
				}
			},
			generateBranchName: async ({ chatId, prompt, model }) => {
				const { client, directory } = await chats.chatClient(chatId);
				const branch = await serverCall("name the branch", () =>
					client.generateBranchName(directory, chatId, {
						prompt,
						...(model ? wireModel(model) : {}),
					}),
				);
				return { branch };
			},
		},
	});
}
