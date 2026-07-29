import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import {
	listNotesOutput,
	addNoteOutput,
	deleteNoteOutput,
	clearNotesOutput,
	echoOutput,
} from "@anaconda-agentic-desktop/contracts";

export const notesQueryKey = ["sdk-explorer", "notes"] as const;

export function listNotesQueryOptions(sdk: SDK) {
	return queryOptions({
		queryKey: notesQueryKey,
		queryFn: async () => listNotesOutput.parse(await sdk.invoke("list")),
	});
}

export function addNoteMutationOptions(sdk: SDK, qc: QueryClient) {
	return mutationOptions({
		mutationKey: ["sdk-explorer", "add"] as const,
		mutationFn: async (text: string) => addNoteOutput.parse(await sdk.invoke("add", { text })),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: notesQueryKey });
		},
	});
}

export function deleteNoteMutationOptions(sdk: SDK, qc: QueryClient) {
	return mutationOptions({
		mutationKey: ["sdk-explorer", "delete"] as const,
		mutationFn: async (id: string) => deleteNoteOutput.parse(await sdk.invoke("delete", { id })),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: notesQueryKey });
		},
	});
}

export function clearNotesMutationOptions(sdk: SDK, qc: QueryClient) {
	return mutationOptions({
		mutationKey: ["sdk-explorer", "clear"] as const,
		mutationFn: async () => clearNotesOutput.parse(await sdk.invoke("clear")),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: notesQueryKey });
		},
	});
}

export function echoMutationOptions(sdk: SDK) {
	return mutationOptions({
		mutationKey: ["sdk-explorer", "echo"] as const,
		mutationFn: async (message: string) => echoOutput.parse(await sdk.invoke("echo", { message })),
	});
}
