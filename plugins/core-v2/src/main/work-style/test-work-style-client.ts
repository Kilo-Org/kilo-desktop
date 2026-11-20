import type { KiloWorkStyleClient } from "./apply-work-style";
import type { PermissionConfig } from "./work-style-presets";

export interface FakeWorkStyleClient {
	readonly client: KiloWorkStyleClient;
	/** The `permission` block of the user's global config. */
	permission: PermissionConfig | undefined;
	readonly calls: string[];
	readonly updates: PermissionConfig[];
	/** While set, the next config write fails with it (once). */
	failNextUpdate?: Error | undefined;
}

/**
 * Merges a patch the way Kilo's `global.config.update` merges `permission`:
 * `null` deletes, pattern maps merge per pattern, and a scalar merged under
 * a map is promoted to `{ "*": scalar }`.
 */
export function mergePermission(
	current: PermissionConfig,
	patch: PermissionConfig,
): PermissionConfig {
	const next: PermissionConfig = structuredClone(current);
	for (const [key, rule] of Object.entries(patch)) {
		if (rule === null || rule === undefined) {
			delete next[key];
		} else if (typeof rule === "string") {
			next[key] = rule;
		} else {
			const existing = next[key];
			const merged: Record<string, string> =
				typeof existing === "string"
					? { "*": existing }
					: { ...(existing as Record<string, string> | undefined) };
			for (const [pattern, action] of Object.entries(rule)) {
				if (action === null) delete merged[pattern];
				else merged[pattern] = action;
			}
			next[key] = merged as PermissionConfig[string];
		}
	}
	return next;
}

/** The user's global Kilo config's `permission` block in memory, behind the client. */
export function createFakeWorkStyleClient(permission?: PermissionConfig): FakeWorkStyleClient {
	const fake: FakeWorkStyleClient = {
		permission: permission ? structuredClone(permission) : undefined,
		calls: [],
		updates: [],
		client: {
			readGlobalPermission: async () => {
				fake.calls.push("read");
				return fake.permission;
			},
			updateGlobalConfig: async ({ permission: patch }) => {
				fake.calls.push("update");
				if (fake.failNextUpdate) {
					const error = fake.failNextUpdate;
					fake.failNextUpdate = undefined;
					throw error;
				}
				fake.updates.push(patch);
				fake.permission = mergePermission(fake.permission ?? {}, patch);
			},
			disposeInstances: async () => {
				fake.calls.push("dispose");
			},
		},
	};
	return fake;
}
