import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { invokeDesktop } from "@/lib/query/client";

export const todosQueryKey = ["todos"] as const;

export function todosQueryOptions() {
	return queryOptions({
		queryKey: todosQueryKey,
		queryFn: () => invokeDesktop("todos:list"),
	});
}

export function addTodoMutationOptions(queryClient: QueryClient) {
	return mutationOptions({
		mutationKey: ["todos", "add"] as const,
		mutationFn: (title: string) => invokeDesktop("todos:add", { title }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: todosQueryKey });
		},
	});
}

export function toggleTodoMutationOptions(queryClient: QueryClient) {
	return mutationOptions({
		mutationKey: ["todos", "toggle"] as const,
		mutationFn: (id: string) => invokeDesktop("todos:toggle", { id }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: todosQueryKey });
		},
	});
}
