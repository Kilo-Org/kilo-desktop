import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createFakeSdk } from "@anaconda-agentic-desktop/testing";
import {
	sdkProducerContract,
	type Note,
	type SdkProducerService,
} from "@anaconda-agentic-desktop/contracts";
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import {
	addNoteMutationOptions,
	clearNotesMutationOptions,
	deleteNoteMutationOptions,
	echoMutationOptions,
	listNotesQueryOptions,
	notesQueryKey,
} from "./useNotes";

function makeSdk(initial: Note[] = []): SDK<SdkProducerService> {
	let notes = [...initial];
	return createFakeSdk({
		featureId: "sdk-producer",
		channels: sdkProducerContract,
		handlers: {
			list: () => [...notes],
			add: (input: { text: string }) => {
				const note: Note = { id: crypto.randomUUID(), text: input.text, createdAt: Date.now() };
				notes.push(note);
				return note;
			},
			delete: (input: { id: string }) => {
				const before = notes.length;
				notes = notes.filter((n) => n.id !== input.id);
				return { deleted: notes.length < before };
			},
			clear: () => {
				const count = notes.length;
				notes = [];
				return { count };
			},
			echo: (input: { message: string }) => ({
				echoed: `[echo] ${input.message}`,
				timestamp: Date.now(),
			}),
		},
	}) as unknown as SDK<SdkProducerService>;
}

const mutationCtx = {} as never;

describe("useNotes query/mutation options", () => {
	it("lists notes via sdk.client", async () => {
		const sdk = makeSdk([{ id: "1", text: "hi", createdAt: 1 }]);
		const options = listNotesQueryOptions(sdk);
		expect(options.queryKey).toEqual(notesQueryKey);
		await expect(options.queryFn!({} as never)).resolves.toEqual([
			{ id: "1", text: "hi", createdAt: 1 },
		]);
	});

	it("add/delete/clear invalidate the notes query", async () => {
		const sdk = makeSdk([{ id: "1", text: "hi", createdAt: 1 }]);
		const qc = new QueryClient();
		qc.setQueryData(notesQueryKey, [{ id: "1", text: "hi", createdAt: 1 }]);

		const added = await addNoteMutationOptions(sdk, qc).mutationFn!("new", mutationCtx);
		expect(added.text).toBe("new");
		await addNoteMutationOptions(sdk, qc).onSuccess?.(added, "new", undefined, mutationCtx);

		await expect(deleteNoteMutationOptions(sdk, qc).mutationFn!("1", mutationCtx)).resolves.toEqual(
			{
				deleted: true,
			},
		);
		await deleteNoteMutationOptions(sdk, qc).onSuccess?.(
			{ deleted: true },
			"1",
			undefined,
			mutationCtx,
		);

		await expect(
			clearNotesMutationOptions(sdk, qc).mutationFn?.(undefined as never, mutationCtx),
		).resolves.toEqual({
			count: 1,
		});
		await clearNotesMutationOptions(sdk, qc).onSuccess?.(
			{ count: 1 },
			undefined,
			undefined,
			mutationCtx,
		);
	});

	it("echoes through sdk.client", async () => {
		const sdk = makeSdk();
		const result = await echoMutationOptions(sdk).mutationFn!("hello", mutationCtx);
		expect(result.echoed).toBe("[echo] hello");
	});
});
