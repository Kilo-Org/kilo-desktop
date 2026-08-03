import { createFileRoute } from "@tanstack/react-router";

import { NotebookView } from "@/features/notebook/NotebookView";

export const Route = createFileRoute("/notebook")({
	component: NotebookView,
});
