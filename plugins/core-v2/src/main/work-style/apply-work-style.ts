import type { ServerConnection, WorkStyle } from "../../contracts";
import {
	conflictingPermissionActions,
	planWorkStyle,
	type AppliedWorkStyle,
	type PermissionRule,
} from "./work-style-presets";

/**
 * The part of the Kilo server's API the work-style area uses, so tests can
 * fake it: the `permissions` list of the user's global config. On Kilo v2
 * that is Desktop's own config directory (`KILO2_CONFIG_DIR`); writes apply
 * live, so nothing needs reloading.
 */
export interface KiloWorkStyleClient {
	readGlobalPermissions(): Promise<readonly PermissionRule[] | undefined>;
	/** Replaces the whole `permissions` list. */
	writeGlobalPermissions(permissions: readonly PermissionRule[]): Promise<void>;
}

export type CreateKiloWorkStyleClient = (connection: ServerConnection) => KiloWorkStyleClient;

/** Permission actions whose rules Review first would replace in the user's global config. */
export async function findConflictingPermissionKeys(
	client: KiloWorkStyleClient,
): Promise<string[]> {
	return conflictingPermissionActions(await client.readGlobalPermissions());
}

/**
 * Applies a work style to the user's global Kilo config. Returns this
 * session's Review first write (with the rules it replaced) so a later switch
 * can restore exactly them.
 */
export async function applyWorkStyle(
	client: KiloWorkStyleClient,
	style: WorkStyle,
	applied: AppliedWorkStyle | null,
): Promise<{ applied: AppliedWorkStyle | null }> {
	const plan = planWorkStyle({
		style,
		permissions: await client.readGlobalPermissions(),
		applied,
	});
	if (plan.permissions) await client.writeGlobalPermissions(plan.permissions);
	return { applied: plan.applied };
}
