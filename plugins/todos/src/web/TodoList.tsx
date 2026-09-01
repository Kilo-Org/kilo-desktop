import { type FormEvent, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import {
	sdkQueryOptions,
	useFeatureFlag,
	useSdk,
	useSdkMutation,
} from "@anaconda-agentic-desktop/sdk-react";

import type { TodoService } from "../contracts/schemas.js";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Checkbox } from "@anaconda-agentic-desktop/ui/components/checkbox";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { Label } from "@anaconda-agentic-desktop/ui/components/label";
import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";

/**
 * LaunchDarkly feature-flag key that gates this panel, the plugin's tool
 * registrations, and the main-process contract handlers. Kept in sync with
 * `FEATURE_FLAG_KEY` in `plugins/todos/src/main/index.ts`.
 */
const FEATURE_FLAG_KEY = "todo-feature";

export function TodoList() {
	const featureEnabled = useFeatureFlag<boolean>(FEATURE_FLAG_KEY, false);
	const sdk = useSdk<TodoService>("todos");
	// Gate the query on the flag so it never fires while the feature is
	// off. Without this the first render's `peek()` returns `{}`, so the
	// query goes out, the main handler answers `FEATURE_DISABLED`, and the
	// error stays cached in TanStack Query — surfacing as a misleading
	// "Could not load todos: Todos feature is disabled." banner the moment
	// the flag flips on.
	const todos = useQuery({ ...sdkQueryOptions(sdk, "list"), enabled: featureEnabled });
	const addTodo = useSdkMutation(sdk, "add", { invalidates: ["list"] });
	const toggleTodo = useSdkMutation(sdk, "toggle", { invalidates: ["list"] });
	const [title, setTitle] = useState("");
	const mutationError = addTodo.error ?? toggleTodo.error;
	const showFeatureFlagBanner = useFeatureFlag("test");

	if (!featureEnabled) {
		return (
			<div className="flex h-full min-h-0 flex-col" data-qa-id="todos-page" data-state="flag-off">
				<div className="mx-auto w-full max-w-xl px-5 py-8">
					<p className="text-muted-foreground text-sm" data-qa-id="todos-unavailable">
						This feature is not enabled for your account. Contact your Anaconda administrator or try
						again later.
					</p>
				</div>
			</div>
		);
	}

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const normalizedTitle = title.trim();
		if (!normalizedTitle || addTodo.isPending) return;
		addTodo.mutate(
			{ title: normalizedTitle },
			{
				onSuccess: () => setTitle(""),
			},
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-qa-id="todos-page">
			<div className="mx-auto w-full max-w-xl px-5 py-8">
				<p className="text-muted-foreground text-sm">
					Todos load and update through the feature SDK with TanStack Query.
				</p>

				{showFeatureFlagBanner ? (
					<p
						className="text-primary mt-1 text-sm font-medium"
						data-qa-id="todos-feature-flag-banner"
					>
						Now with more feature flags!
					</p>
				) : null}

				<form className="my-6 grid gap-2" onSubmit={submit}>
					<Label htmlFor="new-todo">New todo</Label>
					<Input
						id="new-todo"
						data-qa-id="todo-input"
						placeholder="Buy milk"
						maxLength={120}
						autoComplete="off"
						value={title}
						aria-invalid={addTodo.isError}
						onChange={(event) => setTitle(event.target.value)}
					/>
					<Button type="submit" data-qa-id="todo-add" disabled={!title.trim() || addTodo.isPending}>
						{addTodo.isPending ? "Adding…" : "Add todo"}
					</Button>
				</form>

				{todos.isError ? (
					<p className="text-destructive text-sm" role="alert">
						Could not load todos: {todos.error.message}
					</p>
				) : null}
				{mutationError ? (
					<p className="text-destructive text-sm" role="alert">
						Could not update todos: {mutationError.message}
					</p>
				) : null}

				{todos.isPending ? (
					<p className="text-muted-foreground text-sm">Loading todos…</p>
				) : todos.data?.length === 0 ? (
					<p className="text-muted-foreground text-sm">No todos yet.</p>
				) : todos.data ? (
					<ul className="m-0 grid list-none gap-2 p-0" aria-label="Todos">
						{todos.data.map((todo) => (
							<li key={todo.id}>
								<Label className="gap-3">
									<Checkbox
										checked={todo.completed}
										disabled={toggleTodo.isPending}
										onCheckedChange={() =>
											toggleTodo.mutate(
												{ id: todo.id },
												{
													onSuccess: (updated) => {
														if (updated.completed) toast.success("Nice job!");
													},
												},
											)
										}
									/>
									<span
										className={todo.completed ? "text-muted-foreground line-through" : undefined}
									>
										{todo.title}
									</span>
								</Label>
							</li>
						))}
					</ul>
				) : null}
			</div>
		</div>
	);
}
