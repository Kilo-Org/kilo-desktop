import type { PermissionRule, ServerConnection, WorkStyle } from "../../contracts";
import {
	conflictingPermissionKeys,
	planWorkStylePatch,
	type AppliedWorkStyle,
} from "./work-style-presets";

/**
 * The part of the Kilo server's API the work-style area uses, so tests can
 * fake it. `readGlobalPermissions` reads only the user's global config file
 * (`kilocode.settings` `global`), not Desktop's own `KILO2_CONFIG` layer, so
 * the conflict check sees exactly the rules the user wrote themselves.
 */
export interface KiloWorkStyleClient {
	readGlobalPermissions(): Promise<readonly PermissionRule[] | undefined>;
	/** Replaces the user's global `permissions`. */
	writeGlobalPermissions(permissions: readonly PermissionRule[]): Promise<void>;
	/** Reloads the server's locations so they read the config. */
	reload(): Promise<void>;
}

export type CreateKiloWorkStyleClient = (connection: ServerConnection) => KiloWorkStyleClient;

/** Actions with rules review first would override in the user's global config. */
export async function findConflictingPermissionKeys(
	client: KiloWorkStyleClient,
): Promise<string[]> {
	return conflictingPermissionKeys(await client.readGlobalPermissions());
}

/**
 * Applies a work style to the user's global Kilo config, which is shared with
 * the Kilo CLI and VS Code extension. Returns this session's review-first
 * write (with the rules it replaced) so a later switch can restore exactly them.
 */
export async function applyWorkStyle(
	client: KiloWorkStyleClient,
	style: WorkStyle,
	applied: AppliedWorkStyle | null,
): Promise<{ applied: AppliedWorkStyle | null }> {
	const plan = planWorkStylePatch({
		style,
		globalPermissions: await client.readGlobalPermissions(),
		applied,
	});
	if (plan.permissions) {
		await client.writeGlobalPermissions(plan.permissions);
		await client.reload();
	}
	return { applied: plan.applied };
}
