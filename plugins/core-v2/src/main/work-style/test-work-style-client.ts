import type { KiloWorkStyleClient } from "./apply-work-style";
import type { PermissionRule } from "./work-style-presets";

export interface FakeWorkStyleClient {
	readonly client: KiloWorkStyleClient;
	/** The `permissions` list of the user's global config. */
	permissions: readonly PermissionRule[] | undefined;
	readonly calls: string[];
	readonly writes: (readonly PermissionRule[])[];
	/** While set, the next config write fails with it (once). */
	failNextWrite?: Error | undefined;
}

/** The user's global Kilo config's `permissions` list in memory, behind the client. */
export function createFakeWorkStyleClient(
	permissions?: readonly PermissionRule[],
): FakeWorkStyleClient {
	const fake: FakeWorkStyleClient = {
		permissions: permissions ? structuredClone(permissions) : undefined,
		calls: [],
		writes: [],
		client: {
			readGlobalPermissions: async () => {
				fake.calls.push("read");
				return fake.permissions;
			},
			writeGlobalPermissions: async (next) => {
				fake.calls.push("write");
				if (fake.failNextWrite) {
					const error = fake.failNextWrite;
					fake.failNextWrite = undefined;
					throw error;
				}
				fake.writes.push(next);
				fake.permissions = structuredClone(next);
			},
		},
	};
	return fake;
}
