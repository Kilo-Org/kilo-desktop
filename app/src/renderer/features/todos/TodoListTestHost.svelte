<script lang="ts">
	import { QueryClientProvider, type QueryClient } from "@tanstack/svelte-query";

	import TodoList from "./TodoList.svelte";

	let { client }: { client: QueryClient } = $props();
</script>

<QueryClientProvider {client}>
	<TodoList />
</QueryClientProvider>
