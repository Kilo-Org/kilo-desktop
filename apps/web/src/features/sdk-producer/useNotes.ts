import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { SdkProducerService } from "@anaconda-agentic-desktop/contracts";
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

export const notesQueryKey = ["sdk-producer", "notes"] as const;

type ProducerSdk = SDK<SdkProducerService>;

export function listNotesQueryOptions(sdk: ProducerSdk) {
	return queryOptions({
		queryKey: notesQueryKey,
		queryFn: () => sdk.client.list(),
	});
}

export function addNoteMutationOptions(sdk: ProducerSdk, qc: QueryClient) {
	return mutationOptions({
		mutationKey: ["sdk-producer", "add"] as const,
		mutationFn: (text: string) => sdk.client.add({ text }),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: notesQueryKey });
		},
	});
}

export function deleteNoteMutationOptions(sdk: ProducerSdk, qc: QueryClient) {
	return mutationOptions({
		mutationKey: ["sdk-producer", "delete"] as const,
		mutationFn: (id: string) => sdk.client.delete({ id }),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: notesQueryKey });
		},
	});
}

export function clearNotesMutationOptions(sdk: ProducerSdk, qc: QueryClient) {
	return mutationOptions({
		mutationKey: ["sdk-producer", "clear"] as const,
		mutationFn: () => sdk.client.clear(),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: notesQueryKey });
		},
	});
}

export function echoMutationOptions(sdk: ProducerSdk) {
	return mutationOptions({
		mutationKey: ["sdk-producer", "echo"] as const,
		mutationFn: (message: string) => sdk.client.echo({ message }),
	});
}
