import {
	conflictingPermissionKeys,
	planWorkStylePatch,
	type AppliedWorkStyle,
	type PermissionConfig,
	type WorkStyle,
	type WorkStylePatch,
} from "./work-style-presets.js";

type GlobalPermissionSnapshot = { permission?: PermissionConfig };

/** The slice of the Kilo SDK client this module needs (see `provider-mutations.ts`). */
export type WorkStyleClient = {
	global: {
		dispose(): Promise<unknown>;
		config: {
			get(opts?: { throwOnError: true }): Promise<{ data?: GlobalPermissionSnapshot | null }>;
			update(
				input: { config: WorkStylePatch },
				opts?: { throwOnError: true },
			): Promise<{ data?: unknown }>;
		};
	};
};

/**
 * `global.config.get` returns only the user's global files (`~/.config/kilo/`),
 * not Desktop's `KILO_CONFIG_DIR` (which carries `suggest: deny`), so the
 * conflict check sees exactly the rules the user wrote themselves.
 */
async function readGlobalPermission(
	client: WorkStyleClient,
): Promise<PermissionConfig | undefined> {
	const { data } = await client.global.config.get({ throwOnError: true });
	return data?.permission;
}

/** Permission keys Review first would replace in the user's global config. */
export async function findConflictingPermissionKeys(client: WorkStyleClient): Promise<string[]> {
	return conflictingPermissionKeys(await readGlobalPermission(client));
}

/**
 * Applies a work style to the user's global Kilo config, which is shared with
 * the Kilo CLI and VS Code extension. Returns this run's review-first write
 * (with the values it replaced) so a later switch can restore exactly them.
 */
export async function applyWorkStyle(
	client: WorkStyleClient,
	style: WorkStyle,
	applied: AppliedWorkStyle | null,
): Promise<{ applied: AppliedWorkStyle | null }> {
	const plan = planWorkStylePatch({
		style,
		globalPermission: await readGlobalPermission(client),
		applied,
	});
	for (const patch of plan.patches) {
		await client.global.config.update({ config: patch }, { throwOnError: true });
	}
	if (plan.patches.length > 0) await client.global.dispose();
	return { applied: plan.applied };
}
