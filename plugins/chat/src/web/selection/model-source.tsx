import { useEffect, useMemo, useRef, type ReactNode } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { useExtensions } from "@kilo-desktop/kernel/web";

import { ModelSource } from "../../contracts";
import type { PromptModelRef } from "../runtime/prompt-options";
import type { ActiveModelSource } from "./ChatModelSelectionContext";

type Source = Contribution<typeof ModelSource>;

/** Loads a prompt's model first when a model source serves its provider. */
export async function prepareForPrompt(
	model: PromptModelRef,
	sources: readonly Source[],
): Promise<void> {
	const source = sources.find((candidate) => candidate.metadata.providerId === model.providerID);
	await source?.implementation?.prepare?.(model.modelID);
}

/** The window's model sources, latest at call time (for prompts sent later). */
export function useModelSourcesRef(): { readonly current: readonly Source[] } {
	const sources = useRef<readonly Source[]>([]);
	sources.current = useExtensions(ModelSource);
	return sources;
}

/**
 * Reads the first model source's live state for the picker and gives it to
 * `children`; `onModelsChanged` runs when its installed models change, so the
 * catalog can be read again. Keyed by contribution, so a replaced source
 * mounts its own hook.
 */
export function ModelSourceReader({
	onModelsChanged,
	children,
}: {
	readonly onModelsChanged: () => void;
	readonly children: (source: ActiveModelSource | undefined) => ReactNode;
}) {
	const source = useExtensions(ModelSource).find((candidate) => candidate.implementation);
	if (!source) return children(undefined);
	return (
		<SourceState key={source.key} source={source} onModelsChanged={onModelsChanged}>
			{children}
		</SourceState>
	);
}

function SourceState({
	source,
	onModelsChanged,
	children,
}: {
	readonly source: Source;
	readonly onModelsChanged: () => void;
	readonly children: (source: ActiveModelSource) => ReactNode;
}) {
	const implementation = source.implementation!;
	const state = implementation.useState();
	const modelsKey = state.pending ? null : state.modelIds.join("\n");
	const seen = useRef<string | null>(modelsKey);
	const notify = useRef(onModelsChanged);
	notify.current = onModelsChanged;
	useEffect(() => {
		if (modelsKey === null || modelsKey === seen.current) return;
		const first = seen.current === null;
		seen.current = modelsKey;
		if (!first) notify.current();
	}, [modelsKey]);
	const { providerId, title, settingsSection } = source.metadata;
	const hasModels = state.modelIds.length > 0;
	const active = useMemo(
		(): ActiveModelSource => ({
			providerId,
			title,
			settingsSection,
			status: state.status,
			hasModels,
			pending: state.pending,
			start: implementation.start,
		}),
		[providerId, title, settingsSection, state.status, hasModels, state.pending, implementation],
	);
	return children(active);
}
