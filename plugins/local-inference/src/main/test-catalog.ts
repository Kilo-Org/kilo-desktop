// A stand-in `kilo.local-inference/model-catalog` contribution ("Anaconda"),
// as kilo.anaconda will contribute one: its access, sign-in and models are
// set by the test.
import { vi } from "vitest";

import { definePlugin, type PluginRegistration } from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";

import {
	ModelCatalogPoint,
	type ModelCatalogAccess,
	type ModelCatalogEntry,
	type ModelCatalogSignInResult,
	type ModelCatalogSource,
} from "../contracts";

/** A catalog model that fits the test machine (8B, Q4 at 4.9 GB on 16 GB). */
export function catalogModel(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
	return {
		id: "llama",
		name: "Llama 3.1 8B Instruct",
		description: "A compact instruction-tuned language model.",
		numParameters: 8_000_000_000,
		modelType: "LlamaForConditionalGeneration",
		publisher: "Meta",
		libraryName: "transformers",
		license: "llama3.1",
		contextWindowSize: 131_072,
		publishedAt: "2024-07-23T00:00:00Z",
		tags: ["chat"],
		quantizations: [
			{ id: "llama-q4", method: "Q4_K_M", sizeBytes: 4_900_000_000, sha256: "a".repeat(64) },
		],
		capabilities: { chat: true, embedding: false, vision: false, toolCalling: true },
		...overrides,
	};
}

export interface CatalogStandInOptions {
	readonly pluginId?: string;
	readonly title?: string;
	readonly priority?: number;
	readonly access?: ModelCatalogAccess;
	readonly models?: readonly ModelCatalogEntry[];
	/** Leaves `signIn` / `cancelSignIn` out. */
	readonly withoutSignIn?: boolean;
}

/** A plugin contributing one model catalog, and handles to drive it. */
export function catalogStandIn(options: CatalogStandInOptions = {}) {
	let access: ModelCatalogAccess = options.access ?? { status: "signed-in", accountKey: "account" };
	let models = [...(options.models ?? [catalogModel()])];
	const listeners = new Set<() => void>();
	const changed = () => {
		for (const listener of listeners) listener();
	};
	const source = {
		access: () => access,
		subscribe: (onChange: () => void) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		resolveAccess: vi.fn(async () => undefined),
		list: vi.fn(async () => ({ models, total: models.length })),
		downloadUrl: vi.fn(async () => "https://downloads.test/model.gguf"),
		signIn: vi.fn(async (): Promise<ModelCatalogSignInResult> => ({ ok: true })),
		cancelSignIn: vi.fn(async () => undefined),
	};
	const implementation: ModelCatalogSource = options.withoutSignIn
		? {
				access: source.access,
				resolveAccess: source.resolveAccess,
				subscribe: source.subscribe,
				list: source.list,
				downloadUrl: source.downloadUrl,
			}
		: source;
	const pluginId = options.pluginId ?? "test.catalog";
	const registration: PluginRegistration = testPlugin(pluginId, {
		manifest: {
			requires: { [ModelCatalogPoint.id]: "optional" },
			contributes: {
				extensions: {
					[ModelCatalogPoint.id]: [
						{
							id: "catalog",
							title: options.title ?? "Anaconda",
							...(options.priority === undefined ? {} : { priority: options.priority }),
						},
					],
				},
			},
		},
		entry: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(ModelCatalogPoint, "catalog", implementation);
			},
		}),
	});
	return {
		registration,
		source,
		setAccess(next: ModelCatalogAccess) {
			access = next;
			changed();
		},
		setModels(next: readonly ModelCatalogEntry[]) {
			models = [...next];
			changed();
		},
	};
}
