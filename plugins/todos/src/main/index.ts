import path from "node:path";

import { FeatureError } from "@kilo-desktop/feature-sdk";

import { todosContract } from "../contracts/schemas.js";

import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import { createTodosDatabase } from "./db.js";
import { TodoService } from "./TodoService.js";

/**
 * LaunchDarkly feature-flag key. When this evaluates to `false` (the default,
 * used when the flag is missing, the provider errors, or the user is not in
 * an enabled cohort) every contract handler short-circuits with a
 * `FEATURE_DISABLED` `FeatureError`. Mirrors the anaconda-mcp gate pattern
 * (see `apps/desktop/src/main/features/anaconda-mcp/AnacondaMcpService.ts`).
 *
 * Kept in sync with the renderer-side key in
 * `plugins/todos/src/web/TodoList.tsx`.
 */
export const FEATURE_FLAG_KEY = "todo-feature";

/**
 * Duck-typed shape of the `feature-flag` capability contributed by the
 * `apps/desktop` feature-flag feature. Redefined locally so the plugin
 * stays free of a hard dependency on `@kilo-desktop/contracts`
 * (plugins are self-contained); the canonical type is
 * `FeatureFlagMainCapability` in `packages/contracts`.
 */
interface FeatureFlagCapabilityLike extends Record<string, unknown> {
	featureFlag: {
		getFlag<T>(key: string, defaultValue: T): T;
	};
}

function isTodoFeatureEnabled(mainSdk: MainSdk): boolean {
	const featureFlag = mainSdk.plugins.get<FeatureFlagCapabilityLike>("feature-flag");
	return featureFlag?.featureFlag.getFlag<boolean>(FEATURE_FLAG_KEY, false) ?? false;
}

/**
 * Main-process registration for the todos feature.
 *
 * Persists to its own SQLite file under the shell-provided per-feature
 * storage directory (`${userData}/plugins/todos/data.db`) — nothing shares
 * the shell database. Migrations are shipped in the plugin package under
 * `drizzle/` and located via `mainSdk.resolvePluginAsset`; the shell owns
 * the source-vs-packaged layout question. Electron-only: there is
 * deliberately no browserRegister (Decision #7), so browser mode skips todos.
 *
 * Feature-flag gate (`todo-feature`): the whole plugin is behind a
 * LaunchDarkly flag that defaults to off. Channels are always registered so
 * the router surface stays stable, but every handler short-circuits with a
 * `FEATURE_DISABLED` error while the flag is off. The renderer also gates
 * its UI and its tool registrations on the same flag, so the LLM never sees
 * the todo tools when the feature is disabled.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const db = createTodosDatabase(
		path.join(mainSdk.storageDir, "data.db"),
		mainSdk.resolvePluginAsset("drizzle"),
	);
	const service = new TodoService(db);

	const guarded = <T>(fn: () => T): T => {
		if (!isTodoFeatureEnabled(mainSdk)) {
			throw new FeatureError("Todos feature is disabled.", "BUSINESS");
		}
		return fn();
	};

	mainSdk.channels(todosContract).handleAll({
		list: () => guarded(() => service.list()),
		add: (input) => guarded(() => service.add(input.title)),
		toggle: (input) => guarded(() => service.toggle(input.id)),
	});

	mainSdk.onDispose(() => {
		db.$client.close();
	});
}
