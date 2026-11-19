import type { ComponentType, ReactNode } from "react";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

/** Where a model source's server is, as the model picker shows it. */
export type ModelSourceStatus =
	| { readonly status: "idle" }
	| { readonly status: "preparing-runtime" }
	| { readonly status: "starting" }
	| { readonly status: "ready"; readonly loadedModelId?: string }
	| { readonly status: "loading-model"; readonly modelId: string }
	| { readonly status: "error"; readonly message: string };

/** What a model source reports to the composer. */
export interface ModelSourceState {
	/** Null until known. */
	readonly status: ModelSourceStatus | null;
	/** Models the source has installed (the provider may not list them yet). */
	readonly modelIds: readonly string[];
	/** True until `modelIds` is known. */
	readonly pending: boolean;
}

/**
 * Props of a source's `State` component: it reads the source's live state
 * with hooks and returns `children(state)`.
 */
export interface ModelSourceStateProps {
	readonly children: (state: ModelSourceState) => ReactNode;
}

export interface ModelSourceImplementation {
	/** Rendered in the composer to report the source's live state. */
	readonly State: ComponentType<ModelSourceStateProps>;
	/** Starts the source's server (choosing its rail in the model picker does this). */
	readonly start?: () => Promise<void>;
	/** Loads a model before a prompt that uses it is sent. */
	readonly prepare?: (modelId: string) => Promise<void>;
}

/**
 * A model provider that runs on this device (the Local Model Server): its
 * rail in the composer's model picker (shown even before Kilo lists the
 * provider, with an empty state that opens `settingsSection`), starting its
 * server when the rail is chosen, and loading a model before a prompt for
 * `aiProviderId` is sent.
 */
export const ModelSource = defineExtensionPoint({
	id: "kilo.chat/model-source",
	kind: "additive",
	description: "A local model provider: its model picker rail and model loading before prompts.",
	metadata: z.object({
		/** The AI provider's id in Kilo's config. */
		aiProviderId: z.string().min(1),
		/** The rail's label. */
		title: z.string().min(1),
		/** The settings section where its models are managed. */
		settingsSection: z.string().min(1).optional(),
	}),
	implementation: implementation<ModelSourceImplementation>("renderer"),
});
