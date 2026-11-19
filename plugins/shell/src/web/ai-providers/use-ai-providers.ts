import { useEffect, useRef, useState } from "react";

import type { DomainObjectMethods } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	Models,
	type CustomAiProvider,
	type ModelsState,
} from "@kilo-desktop/plugin-core/contracts";

type ModelsMethods = DomainObjectMethods<typeof Models>;

/** What a failure belongs to: the editors and dialogs show their own; the page shows the rest. */
type Operation = "load" | "connect" | "save" | "disconnect";

type Errors = Partial<Record<Operation, string>>;

const selectAiProviders = (state: ModelsState) => state.aiProviders;
const selectReady = (state: ModelsState) => state.ready;

function message(error: unknown): string {
	return error instanceof Error && error.message ? error.message : String(error);
}

function withError(errors: Errors, operation: Operation, error: string | undefined): Errors {
	const rest = { ...errors };
	delete rest[operation];
	return error === undefined ? rest : { ...rest, [operation]: error };
}

/** Awaits `work`, reporting its outcome; a failure is still rethrown. */
async function settle(
	work: () => Promise<unknown>,
	report: { succeeded(): void; failed(error: unknown): void; settled(): void },
): Promise<void> {
	try {
		await work();
		report.succeeded();
	} catch (error) {
		report.failed(error);
		throw error;
	} finally {
		report.settled();
	}
}

/**
 * The AI providers of `kilo.core/models` and the changes the list makes to
 * them. While kilo.core hasn't read them yet, the list asks it to (which
 * starts the server); a failed read is the `load` error, retried by
 * `reload`. kilo.core re-reads after each change, so the state that comes
 * back is the result; only one change is in flight at a time (`pending`).
 * A change clears the error of its own kind when it starts, and every error
 * when it succeeds.
 */
export function useAiProviders() {
	const models = useDomainObject(Models);
	const aiProviders = useDomainObjectState(Models, selectAiProviders);
	const ready = useDomainObjectState(Models, selectReady) ?? false;
	const [errors, setErrors] = useState<Errors>({});
	const [running, setRunning] = useState(0);
	const [loading, setLoading] = useState(false);
	const mounted = useRef(true);
	useEffect(
		() => () => {
			mounted.current = false;
		},
		[],
	);

	const setError = (operation: Operation, error: string | undefined) => {
		if (!mounted.current) return;
		setErrors((current) => withError(current, operation, error));
	};

	const reload = async () => {
		if (!models) return;
		setLoading(true);
		setError("load", undefined);
		try {
			await models.methods.refresh(undefined);
		} catch (error) {
			setError("load", message(error));
		}
		if (mounted.current) setLoading(false);
	};

	const requested = useRef(false);
	useEffect(() => {
		if (!models || ready || requested.current) return;
		requested.current = true;
		void reload();
	}, [models, ready, reload]);

	const run = async (
		operation: Operation,
		change: (methods: ModelsMethods) => Promise<unknown>,
	) => {
		if (!models) throw new Error("Kilo isn't available.");
		setRunning((count) => count + 1);
		setError(operation, undefined);
		await settle(() => change(models.methods), {
			succeeded: () => {
				if (mounted.current) setErrors({});
			},
			failed: (error) => setError(operation, message(error)),
			settled: () => {
				if (mounted.current) setRunning((count) => count - 1);
			},
		});
	};

	const readCustom = (aiProviderId: string) =>
		models ? models.methods.customAiProvider({ aiProviderId }) : Promise.resolve(null);

	const presentEnv = (names: readonly string[]) =>
		models
			? models.methods.presentEnv({ names: [...names] })
			: Promise.resolve({ names: [] as string[] });

	return {
		available: models !== null,
		aiProviders: aiProviders ?? {},
		ready,
		loading: !ready && (loading || errors.load === undefined),
		loadFailed: !ready && errors.load !== undefined,
		pending: running > 0,
		/** The latest failure the page shows, newest kind first. */
		error: errors.connect ?? errors.disconnect ?? errors.save ?? errors.load ?? null,
		connectError: errors.connect ?? null,
		saveError: errors.save ?? null,
		reload,
		resetConnect: () => setError("connect", undefined),
		resetSave: () => setError("save", undefined),
		connect: (aiProviderId: string, apiKey: string) =>
			run("connect", (methods) => methods.connectAiProvider({ aiProviderId, apiKey })),
		disconnect: (aiProviderId: string) =>
			run("disconnect", (methods) => methods.disconnectAiProvider({ aiProviderId })),
		saveCustom: (provider: CustomAiProvider) =>
			run("save", (methods) => methods.saveCustomAiProvider(provider)),
		readCustom,
		presentEnv,
	};
}

export type AiProvidersModel = ReturnType<typeof useAiProviders>;
