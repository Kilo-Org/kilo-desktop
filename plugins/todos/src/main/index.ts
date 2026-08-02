import path from "node:path";

import { todosContract } from "../contracts/schemas.js";

import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { createTodosDatabase } from "./db.js";
import { TodoService } from "./TodoService.js";

/**
 * Main-process registration for the todos feature.
 *
 * Persists to its own SQLite file under the shell-provided per-feature
 * storage directory (`${userData}/plugins/todos/data.db`) — nothing shares
 * the shell database. Electron-only: there is deliberately no
 * browserRegister (Decision #7), so browser mode skips todos.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const db = createTodosDatabase(path.join(mainSdk.storageDir, "data.db"));
	const service = new TodoService(db);

	mainSdk.channels(todosContract).handleAll({
		list: () => service.list(),
		add: (input) => service.add(input.title),
		toggle: (input) => service.toggle(input.id),
	});

	mainSdk.onDispose(() => {
		db.$client.close();
	});
}
