import { type FormEvent, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { sdkQueryOptions, useFeatureFlag, useSdk, useSdkMutation } from "@kilo-desktop/sdk-react";

import type { TodoService } from "../contracts/schemas.js";

import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { Label } from "@kilo-desktop/ui/components/label";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { CircleAlertIcon, ListTodoIcon, RefreshCwIcon } from "lucide-react";

const SKELETON_ROWS = ["first", "second", "third"];

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
				<div className="mx-auto w-full max-w-3xl px-5 py-8">
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
			<div className="mx-auto w-full max-w-3xl px-5 py-8">
				<p className="text-muted-foreground text-sm">
					Todos load and update through the feature SDK with TanStack Query.
				</p>

				{showFeatureFlagBanner ? (
					<p
						className="text-primary-ink mt-1 text-sm font-medium"
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
						{addTodo.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						{addTodo.isPending ? "Adding…" : "Add todo"}
					</Button>
				</form>

				{mutationError ? (
					<FieldError className="mb-4">Could not update todos: {mutationError.message}</FieldError>
				) : null}

				{todos.isError ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<CircleAlertIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Could not load todos</EmptyTitle>
							<EmptyDescription>{todos.error.message}</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button type="button" variant="outline" onClick={() => void todos.refetch()}>
								<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
								Try again
							</Button>
						</EmptyContent>
					</Empty>
				) : todos.isPending ? (
					<div role="status" aria-busy="true" aria-label="Loading todos" className="grid gap-2">
						{SKELETON_ROWS.map((row) => (
							<div key={row} className="flex items-center gap-3" aria-hidden="true">
								<Skeleton className="size-4" />
								<Skeleton className="h-3.5 w-48" />
							</div>
						))}
					</div>
				) : todos.data?.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<ListTodoIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No todos yet</EmptyTitle>
							<EmptyDescription>Add one above to get started.</EmptyDescription>
						</EmptyHeader>
					</Empty>
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
