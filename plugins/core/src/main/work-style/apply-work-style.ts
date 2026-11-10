import type { ServerConnection, WorkStyle } from "../../contracts";
import {
	conflictingPermissionKeys,
	planWorkStylePatch,
	type AppliedWorkStyle,
	type PermissionConfig,
	type WorkStylePatch,
} from "./work-style-presets";

/**
 * The part of the Kilo server's API the work-style area uses, so tests can
 * fake it. `readGlobalPermission` reads only the user's global files
 * (`~/.config/kilo/`), not Desktop's `KILO_CONFIG_DIR` (which carries
 * `suggest: deny`), so the conflict check sees exactly the rules the user
 * wrote themselves.
 */
export interface KiloWorkStyleClient {
	readGlobalPermission(): Promise<PermissionConfig | undefined>;
	/** Deep-merges `patch` into the user's global config; `null` deletes. */
	updateGlobalConfig(patch: WorkStylePatch): Promise<void>;
	/** Disposes the server's instances so they reload the config. */
	disposeInstances(): Promise<void>;
}

export type CreateKiloWorkStyleClient = (connection: ServerConnection) => KiloWorkStyleClient;

/** Permission keys Review first would replace in the user's global config. */
export async function findConflictingPermissionKeys(
	client: KiloWorkStyleClient,
): Promise<string[]> {
	return conflictingPermissionKeys(await client.readGlobalPermission());
}

/**
 * Applies a work style to the user's global Kilo config, which is shared with
 * the Kilo CLI and VS Code extension. Returns this session's review-first
 * write (with the values it replaced) so a later switch can restore exactly them.
 */
export async function applyWorkStyle(
	client: KiloWorkStyleClient,
	style: WorkStyle,
	applied: AppliedWorkStyle | null,
): Promise<{ applied: AppliedWorkStyle | null }> {
	const plan = planWorkStylePatch({
		style,
		globalPermission: await client.readGlobalPermission(),
		applied,
	});
	for (const patch of plan.patches) await client.updateGlobalConfig(patch);
	if (plan.patches.length > 0) await client.disposeInstances();
	return { applied: plan.applied };
}
