<script lang="ts">
	import { createMutation, createQuery, useQueryClient } from "@tanstack/svelte-query";

	import { Button } from "$lib/components/ui/button/index.js";
	import { addTodoMutationOptions, todosQueryOptions, toggleTodoMutationOptions } from "./todos.js";

	const queryClient = useQueryClient();
	const todos = createQuery(() => todosQueryOptions());
	const addTodo = createMutation(() => addTodoMutationOptions(queryClient));
	const toggleTodo = createMutation(() => toggleTodoMutationOptions(queryClient));

	let title = $state("");
	let mutationError = $derived(addTodo.error ?? toggleTodo.error);

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const normalizedTitle = title.trim();
		if (!normalizedTitle || addTodo.isPending) return;
		addTodo.mutate(normalizedTitle, {
			onSuccess: () => {
				title = "";
			},
		});
	}
</script>

<main>
	<h1>Todo List</h1>
	<p>Todos load and update over typed IPC with TanStack Query.</p>

	<form onsubmit={submit}>
		<label for="new-todo">New todo</label>
		<input
			id="new-todo"
			placeholder="Buy milk"
			maxlength={120}
			autocomplete="off"
			bind:value={title}
		/>
		<Button type="submit" disabled={!title.trim() || addTodo.isPending}>
			{addTodo.isPending ? "Adding…" : "Add todo"}
		</Button>
	</form>

	{#if todos.isError}
		<p role="alert">Could not load todos: {todos.error.message}</p>
	{/if}

	{#if mutationError}
		<p role="alert">Could not update todos: {mutationError.message}</p>
	{/if}

	{#if todos.isPending}
		<p>Loading todos…</p>
	{:else if todos.data?.length === 0}
		<p>No todos yet.</p>
	{:else if todos.data}
		<ul aria-label="Todos">
			{#each todos.data as todo (todo.id)}
				<li>
					<label>
						<input
							type="checkbox"
							checked={todo.completed}
							disabled={toggleTodo.isPending}
							onchange={() => toggleTodo.mutate(todo.id)}
						/>
						<span class:completed={todo.completed}>{todo.title}</span>
					</label>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 36rem;
		margin: 0 auto;
		padding: 2rem 1.25rem;
	}

	form {
		display: grid;
		gap: 0.5rem;
		margin: 1.5rem 0;
	}

	input:not([type="checkbox"]),
	input[type="checkbox"] + span {
		font: inherit;
	}

	input:not([type="checkbox"]) {
		padding: 0.5rem 0.75rem;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}

	li label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.completed {
		text-decoration: line-through;
		opacity: 0.65;
	}
</style>
