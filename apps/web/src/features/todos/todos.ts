import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

export const todosQueryKey = ["todos"] as const;

export function todosQueryOptions(api: LocalApi) {
	return queryOptions({
		queryKey: todosQueryKey,
		queryFn: () => api.todos.list(),
	});
}

export function addTodoMutationOptions(api: LocalApi, queryClient: QueryClient) {
	return mutationOptions({
		mutationKey: ["todos", "add"] as const,
		mutationFn: (title: string) => api.todos.add({ title }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: todosQueryKey });
		},
	});
}

export function toggleTodoMutationOptions(api: LocalApi, queryClient: QueryClient) {
	return mutationOptions({
		mutationKey: ["todos", "toggle"] as const,
		mutationFn: (id: string) => api.todos.toggle({ id }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: todosQueryKey });
		},
	});
}
