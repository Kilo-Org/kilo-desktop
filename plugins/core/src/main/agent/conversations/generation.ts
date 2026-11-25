import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";

import { Generation } from "../../../contracts";
import type { ConversationsService } from "./index";
import { wireModel } from "./wire";

/**
 * A throwaway chat may answer only through the structured-output sink: its
 * prompt can carry untrusted content (repository diffs). An empty `tools`
 * map on the prompt disables nothing; a chat-level deny-all ruleset does.
 */
export const GENERATE_PERMISSION = [
	{ action: "*", resource: "*", effect: "deny" as const },
	{ action: "StructuredOutput", resource: "*", effect: "allow" as const },
];

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
 * server connection. A generated answer comes from a throwaway chat without
 * the app's stamp, so it is never listed, and is deleted afterwards.
 */
export function provideGeneration(sdk: PluginSdk, chats: ConversationsService): void {
	sdk.domainObjects.provide(Generation, {
		initialState: {},
		methods: {
			generate: async ({ directory, title, system, prompt, schema, model }) => {
				const { client } = await chats.connected();
				const chat = await serverCall("start the request", () =>
					client.createChat(directory, { title, permission: GENERATE_PERMISSION }),
				);
				try {
					const structured = await serverCall("get an answer", () =>
						client.promptStructured(directory, chat.id, {
							system,
							text: prompt,
							schema,
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
					if (structured === null || typeof structured !== "object" || Array.isArray(structured)) {
						throw new KernelError("BUSINESS", "The model did not return a structured answer.");
					}
					return structured as Record<string, unknown>;
				} finally {
					await client.deleteChat(directory, chat.id).catch(() => undefined);
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
