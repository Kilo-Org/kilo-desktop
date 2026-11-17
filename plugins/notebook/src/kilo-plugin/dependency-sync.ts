/**
 * Outcome of syncing recorded notebook dependencies into the running kernel.
 *
 * Recording a dependency and making it importable are separate steps: the
 * declaration lands in the notebook first, then the daemon tries to hot-install
 * it. A sync that does not apply never undoes the recorded edit, and nothing
 * here restarts the kernel; a restart stays an explicit, approved action.
 *
 * `syncEnvironmentResult()` returns the daemon's verdict, which is passed
 * through unchanged. Even `applied` only means the daemon found nothing it
 * could not hot-install for the running environment; a declaration for a
 * different package manager produces an empty diff and still reads `applied`.
 * `managerReport` covers that case separately.
 *
 * SDKs without the typed method only have `syncEnvironment()`. @runtimed/node
 * 0.8.1 resolves it on any daemon completion and rejects with untyped text,
 * and a rejection can also be a dropped connection after the edit applied.
 * Neither outcome is definitive, so both are reported as unconfirmed/unknown.
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
	| { status: "unknown"; typed: boolean; error: string; next_step: string }
	| { status: "completed_unconfirmed"; typed: false; detail: string; next_step: string };

export type PackageManager = "uv" | "conda" | "pixi";

const RESTART_STEP =
	"The daemon says the running kernel needs a restart to use this change. Restart it with notebooks_kernel " +
	"action restart, which asks the user first and clears the kernel's variables. Nothing restarts automatically.";
const INSPECT_STEP =
	"Inspect the error with notebooks_diagnose before changing anything; a restart will not necessarily fix it.";
const UNKNOWN_STEP =
	"Whether the daemon applied this sync is unknown (the request may have failed, or the connection may have " +
	"dropped after it applied). Check notebooks_dependencies action status and notebooks_diagnose before retrying.";
const UNCONFIRMED_STEP =
	"This notebook runtime does not report whether the running kernel can use the change. Verify by importing " +
	"the package, or inspect with notebooks_diagnose.";

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
			return {
				status: "unknown",
				typed: true,
				error: errorMessage(error),
				next_step: UNKNOWN_STEP,
			};
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
		return {
			status: "completed_unconfirmed",
			typed: false,
			detail: "The daemon finished the sync request without reporting what it installed.",
			next_step: UNCONFIRMED_STEP,
		};
	} catch (error) {
		return { status: "unknown", typed: false, error: errorMessage(error), next_step: UNKNOWN_STEP };
	}
}

/** The package manager behind a Running kernel's envSource, or null when it cannot be told. */
export function runningManager(
	runtime: {
		lifecycle?: string;
		envSource?: string;
	} | null,
): PackageManager | null {
	if (runtime?.lifecycle !== "Running" || !runtime.envSource) return null;
	const head = runtime.envSource.split(":")[0];
	return head === "uv" || head === "conda" || head === "pixi" ? head : null;
}

export type ManagerReport =
	| { requested: PackageManager; running: PackageManager; matches: true }
	| {
			requested: PackageManager;
			/** null when the running manager cannot be told; `matches` is then null too. */
			running: PackageManager | null;
			matches: false | null;
			application: "unconfirmed";
			detail: string;
			next_step: string;
	  };

/**
 * Compares an explicitly requested package manager with the running kernel's.
 * A mismatch means the declaration was saved for a manager the kernel does not
 * use, so a daemon `applied` says nothing about it. A restart does not
 * necessarily switch managers either: the daemon picks among the notebook's
 * declarations by its own priority, and existing declarations for the running
 * manager can keep winning. Switching to an existing environment is an explicit
 * notebooks_environment selection; removing the other declarations is never
 * suggested.
 */
export function managerReport(
	requested: PackageManager | undefined,
	runtime: { lifecycle?: string; envSource?: string } | null,
): ManagerReport | undefined {
	if (!requested) return undefined;
	const running = runningManager(runtime);
	if (running === requested) return { requested, running, matches: true };
	const detail =
		running === null
			? `The declaration was saved for ${requested}, but the running kernel's package manager could not be confirmed, so whether these packages are available is unconfirmed.`
			: `The declaration was saved for ${requested}, but the running kernel uses ${running}. The daemon's sync verdict covers the ${running} environment, so these ${requested} packages are not confirmed available.`;
	return {
		requested,
		running,
		matches: running === null ? null : false,
		application: "unconfirmed",
		detail,
		next_step:
			"A restart does not necessarily switch package managers: the notebook's existing declarations can take priority. " +
			"To run in an existing environment, use notebooks_environment action select, then apply. " +
			"Do not delete the notebook's other dependency declarations to force a switch.",
	};
}
