import { useSyncExternalStore } from "react";
import { CircleCheckIcon, ShieldIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import {
	KernelApp,
	KernelPlugins,
	KernelServices,
	KernelWindows,
} from "../builtins/domain-objects";
import type { KernelIssue } from "../discovery";
import type { DomainObjectState } from "../domain-object";
import { useDomainObjectState, useKernel } from "./react";

type RecoveryReason = "no-root" | "missing-view";
type Situation = "healthy" | "problems" | "safe-mode" | "missing-view";
type Issue = Omit<KernelIssue, "pluginId"> & { readonly pluginId?: string | undefined };

const PLATFORM_NAMES = { mac: "macOS", windows: "Windows", linux: "Linux" } as const;

const selectApp = (state: DomainObjectState<typeof KernelApp>) => state;
const selectPlugins = (state: DomainObjectState<typeof KernelPlugins>) => state;
const selectServices = (state: DomainObjectState<typeof KernelServices>) => state.services;

const ICONS = {
	healthy: CircleCheckIcon,
	problems: TriangleAlertIcon,
	"safe-mode": ShieldIcon,
	"missing-view": TriangleAlertIcon,
} as const;

function copyFor(
	situation: Situation,
	startedCount: number,
): { title: string; description: string } {
	switch (situation) {
		case "healthy":
			return {
				title: "Kilo Desktop is running",
				description:
					startedCount === 0
						? "The kernel started, but no plugins are installed yet, so there's no interface to show."
						: "The kernel and its plugins started, but none of them provides the app's interface.",
			};
		case "problems":
			return {
				title: "Kilo Desktop started with problems",
				description:
					"Some plugins couldn't start, and none of the ones that did provides the app's interface. Restart, or restart in safe mode to start without plugins.",
			};
		case "safe-mode":
			return {
				title: "Kilo Desktop is running in safe mode",
				description:
					"Plugins are turned off so you can recover from a problem. Restart normally to turn them back on.",
			};
		case "missing-view":
			return {
				title: "This window's content isn't available",
				description: "The plugin that provides it isn't running.",
			};
	}
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Shown by the kernel when there is nothing else to render. Leads with what
 * did start (kernel, plugins, services); the warning tone and safe mode are
 * reserved for when something actually failed.
 */
export function RecoveryScreen({ reason }: { readonly reason: RecoveryReason }) {
	const kernel = useKernel();
	const app = useDomainObjectState(KernelApp, selectApp);
	const plugins = useDomainObjectState(KernelPlugins, selectPlugins);
	const services = useDomainObjectState(KernelServices, selectServices);
	const localIssues = useSyncExternalStore(
		(onChange) => kernel.onIssuesChange(onChange),
		() => kernel.issues(),
		() => kernel.issues(),
	);
	const problems = uniqueErrors([...(plugins?.issues ?? []), ...localIssues]);
	const started = Object.values(plugins?.plugins ?? {})
		.filter((plugin) => plugin.state === "active")
		.map((plugin) => plugin.displayName);
	const turnedOff = (plugins?.disabled ?? []).map((id) => plugins?.plugins[id]?.displayName ?? id);
	const runningServices = Object.values(services ?? {}).filter(
		(service) => service.status === "ready",
	).length;

	const situation: Situation =
		reason === "missing-view"
			? "missing-view"
			: app?.safeMode
				? "safe-mode"
				: problems.length > 0
					? "problems"
					: "healthy";
	const copy = copyFor(situation, started.length);
	const Icon = ICONS[situation];
	const appMethods = kernel.kernelSdk.domainObjects.get(KernelApp)?.methods;
	const enablePluginsAndRestart = async () => {
		await kernel.kernelSdk.domainObjects.get(KernelPlugins)?.methods.setDisabled({ pluginIds: [] });
		await appMethods?.relaunch({ safeMode: false });
	};

	return (
		<div className="bg-background flex h-screen w-full items-center justify-center p-6">
			<Empty data-qa-id="kernel-recovery" data-situation={situation}>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Icon />
					</EmptyMedia>
					<EmptyTitle>{copy.title}</EmptyTitle>
					<EmptyDescription>{copy.description}</EmptyDescription>
				</EmptyHeader>
				{situation === "missing-view" ? null : (
					<EmptyContent>
						<ul
							data-qa-id="kernel-recovery-status"
							className="text-muted-foreground w-full space-y-1"
						>
							{app ? (
								<li>
									Kernel {app.version} on {PLATFORM_NAMES[app.platform]}
								</li>
							) : null}
							{started.length > 0 ? (
								<li>
									{plural(started.length, "plugin")} started: {started.join(", ")}
								</li>
							) : null}
							{runningServices > 0 ? <li>{plural(runningServices, "service")} running</li> : null}
							{turnedOff.length > 0 ? (
								<li>
									{plural(turnedOff.length, "plugin")} turned off: {turnedOff.join(", ")}
								</li>
							) : null}
						</ul>
					</EmptyContent>
				)}
				{problems.length > 0 && situation === "problems" ? (
					<EmptyContent>
						<ul
							data-qa-id="kernel-recovery-problems"
							className="text-muted-foreground w-full list-disc space-y-1 pl-5 text-left"
						>
							{problems.map((problem) => (
								<li key={`${problem.pluginId ?? "kernel"}:${problem.code}:${problem.message}`}>
									{problem.pluginId ? `${problem.pluginId}: ` : ""}
									{problem.message}
								</li>
							))}
						</ul>
					</EmptyContent>
				) : null}
				<EmptyContent className="flex-row justify-center">
					{situation === "missing-view" ? (
						<Button
							data-qa-id="kernel-recovery-close"
							variant="outline"
							onClick={() => {
								void kernel.kernelSdk.domainObjects
									.get(KernelWindows)
									?.methods.close({ windowId: kernel.window.id });
							}}
						>
							Close window
						</Button>
					) : (
						<>
							{turnedOff.length > 0 ? (
								<Button
									data-qa-id="kernel-recovery-enable-plugins"
									onClick={() => void enablePluginsAndRestart()}
								>
									Turn plugins on and restart
								</Button>
							) : null}
							<Button
								data-qa-id="kernel-recovery-restart"
								variant={situation === "problems" && turnedOff.length === 0 ? "default" : "outline"}
								onClick={() => void appMethods?.relaunch({ safeMode: false })}
							>
								Restart
							</Button>
							{situation === "problems" ? (
								<Button
									data-qa-id="kernel-recovery-safe-mode"
									variant="outline"
									onClick={() => void appMethods?.relaunch({ safeMode: true })}
								>
									Restart in safe mode
								</Button>
							) : null}
							<Button
								data-qa-id="kernel-recovery-quit"
								variant="ghost"
								onClick={() => void appMethods?.quit(undefined)}
							>
								Quit
							</Button>
						</>
					)}
				</EmptyContent>
			</Empty>
		</div>
	);
}

function uniqueErrors(issues: readonly Issue[]): Issue[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		if (issue.severity !== "error") return false;
		const key = `${issue.pluginId ?? ""}:${issue.code}:${issue.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
