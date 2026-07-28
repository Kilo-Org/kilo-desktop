<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { ModeWatcher } from "mode-watcher";
	import { QueryClientProvider } from "@tanstack/svelte-query";

	import "../globals.css";
	import { ThemeState } from "../features/theme/ThemeState.svelte.js";
	import { createDesktopQueryClient } from "$lib/query/client.js";
	import { subscribeQueryInvalidation } from "$lib/query/ipc-bridge.js";

	let { children }: { children: Snippet } = $props();

	const queryClient = createDesktopQueryClient();
	const themeState = new ThemeState();

	onMount(() => {
		void themeState.initialize();
		const unsubscribeInvalidation = subscribeQueryInvalidation(queryClient);
		return () => {
			themeState.destroy();
			unsubscribeInvalidation();
		};
	});
</script>

<ModeWatcher defaultMode="system" disableHeadScriptInjection={true} />
<QueryClientProvider client={queryClient}>
	{@render children()}
</QueryClientProvider>
