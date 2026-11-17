/**
 * Outcome of syncing recorded notebook dependencies into the running kernel.
 *
 * Recording a dependency and making it importable are separate steps: the
 * declaration lands in the notebook first, then the daemon tries to hot-install
 * it. A sync that does not apply never undoes the recorded edit, and nothing
 * here restarts the kernel; a restart stays an explicit, approved action.
 *
 * `syncEnvironmentResult()` returns the daemon's verdict, which is passed
 * through unchanged. SDKs without it only have `syncEnvironment()`, which
 * resolves for an applied sync and rejects for everything else with untyped
 * text; that rejection is reported as `not_applied` without guessing from the
 * message whether a restart would help.
 */
import type { Session } from "@runtimed/node";

import { withTrustGuidance } from "./dependency-approval";

type TypedSyncResult = {
	status: "applied" | "restart_required" | "failed";
	syncedPackages: string[];
	needsRestart: boolean;
	error?: string;
	nextAction: "none" | "restart" | "inspect";
};

type TypedSyncSession = { syncEnvironmentResult(): Promise<TypedSyncResult> };

export type SyncOutcome =
	| {
			status: TypedSyncResult["status"];
			synced_packages: string[];
			needs_restart: boolean;
			next_action: TypedSyncResult["nextAction"];
			error?: string;
			next_step?: string;
	  }
	| { status: "unknown"; error: string; next_step: string }
	| { status: "applied"; typed: false }
	| { status: "not_applied"; typed: false; error: string; next_step: string };

const RESTART_STEP =
	"The running kernel needs a restart to use this change. Restart it with notebooks_kernel action restart, " +
	"which asks the user first and clears the kernel's variables. Nothing restarts automatically.";
const INSPECT_STEP =
	"Inspect the error with notebooks_diagnose before changing anything; a restart will not necessarily fix it.";
const UNKNOWN_STEP =
	"The sync request did not complete, so whether the daemon applied it is unknown. Check notebooks_dependencies " +
	"action status and notebooks_diagnose before retrying.";
const UNTYPED_STEP =
	"This notebook runtime does not say whether a restart would apply the change. Read the error and inspect with " +
	"notebooks_diagnose. If it calls for a restart, use notebooks_kernel action restart, which asks the user first " +
	"and clears the kernel's variables.";

const NEXT_STEPS: Record<TypedSyncResult["nextAction"], string | undefined> = {
	none: undefined,
	restart: RESTART_STEP,
	inspect: INSPECT_STEP,
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function hasTypedSync(session: object): session is TypedSyncSession {
	return typeof (session as Partial<TypedSyncSession>).syncEnvironmentResult === "function";
}

export async function syncOutcome(session: Session): Promise<SyncOutcome> {
	if (hasTypedSync(session)) {
		let result: TypedSyncResult;
		try {
			result = await session.syncEnvironmentResult();
		} catch (error) {
			return { status: "unknown", error: errorMessage(error), next_step: UNKNOWN_STEP };
		}
		const nextStep = NEXT_STEPS[result.nextAction];
		return {
			status: result.status,
			synced_packages: result.syncedPackages,
			needs_restart: result.needsRestart,
			next_action: result.nextAction,
			...(result.error ? { error: result.error } : {}),
			...(nextStep ? { next_step: nextStep } : {}),
		};
	}
	try {
		await withTrustGuidance(session, () => session.syncEnvironment());
		return { status: "applied", typed: false };
	} catch (error) {
		return {
			status: "not_applied",
			typed: false,
			error: errorMessage(error),
			next_step: UNTYPED_STEP,
		};
	}
}
