import { createFileRoute } from "@tanstack/react-router";

import { TodoList } from "@/features/todos/TodoList";

export const Route = createFileRoute("/")({
	component: TodoList,
});
