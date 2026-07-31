import { createFileRoute } from "@tanstack/react-router";

import { TodoList } from "@/features/todos/TodoList";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";

export const Route = createFileRoute("/todos")({
	component: TodosRoute,
});

/**
 * Todos is Electron-only (no browserRegister — Decision #7): its backend
 * needs SQLite in the main process. In standalone browser mode the shell
 * renders an explicit unavailable state instead of a dead page.
 */
function TodosRoute() {
	if (!isDesktopBridgeAvailable()) {
		return (
			<div className="mx-auto max-w-xl px-5 py-8">
				<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="todos-heading">
					Todo List
				</h1>
				<p className="text-muted-foreground mt-1 text-sm" data-qa-id="todos-unavailable">
					Todos are not available in browser mode. Run the desktop app to use this feature.
				</p>
			</div>
		);
	}
	return <TodoList />;
}
