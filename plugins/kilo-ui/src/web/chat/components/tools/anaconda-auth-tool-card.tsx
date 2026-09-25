import { useState, useSyncExternalStore } from "react";
import { ArrowRightIcon } from "lucide-react";

import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { isAnacondaSignInGateForced, useSdk } from "@kilo-desktop/sdk-react";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { AnacondaLogo } from "@kilo-desktop/ui/components/anaconda-logo";
import { Button } from "@kilo-desktop/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kilo-desktop/ui/components/card";

interface AuthGateCapabilities extends Record<string, unknown> {
	authGate: {
		signIn(): Promise<boolean>;
		cancel(): void;
	};
}

const ENVIRONMENT_AUTH_TOOLS = [
	"desktop_environments_conda_setup_open",
	"desktop_environments_conda_envs_create",
	"desktop_environments_conda_envs_clone",
	"desktop_environments_conda_packages_install",
	"desktop_environments_conda_packages_update",
	"desktop_environments_conda_repodata_find",
];

const LOCAL_MODEL_AUTH_TOOL = "desktop_local_inference_settings_open";

export function isAnacondaAuthTool(toolName: string): boolean {
	return toolName === LOCAL_MODEL_AUTH_TOOL || ENVIRONMENT_AUTH_TOOLS.includes(toolName);
}

function toolCopy(toolName: string) {
	if (toolName === LOCAL_MODEL_AUTH_TOOL) {
		return {
			featureId: "local-inference",
			title: "Sign in to view Local Model Server",
			description:
				"The local model catalog is provided by Anaconda. Sign in to continue to its models and server settings.",
		};
	}
	return {
		featureId: "environments",
		title: "Sign in to use Conda Environments",
		description:
			"This environment action uses Anaconda package channels. Sign in to continue and accept Anaconda's Terms of Service.",
	};
}

export function AnacondaAuthToolCard({
	toolName,
	status,
}: Pick<ToolCallMessagePartProps, "toolName" | "status">) {
	const sdk = useSdk("kilo-ui");
	const session = useSyncExternalStore(sdk.auth.subscribe, sdk.auth.peek, sdk.auth.peek);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string>();
	const copy = toolCopy(toolName);
	const gate = sdk.plugins.get<AuthGateCapabilities>(copy.featureId)?.authGate;
	const forced = isAnacondaSignInGateForced(sdk);
	const waiting = status.type === "running" && (forced || session.status !== "authenticated");

	async function signIn() {
		setSubmitting(true);
		setError(undefined);
		try {
			const authenticated = await gate?.signIn();
			if (!authenticated) setError("Sign-in was not completed. Try again to continue.");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSubmitting(false);
		}
	}

	if (!waiting) {
		if (status.type === "running") {
			return (
				<div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
					<Spinner className="size-3" />
					Opening…
				</div>
			);
		}
		if (status.type === "incomplete") {
			return (
				<div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
					{session.status === "authenticated"
						? "The action did not complete."
						: "Sign-in was not completed — the action did not run."}
				</div>
			);
		}
		return (
			<div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
				Anaconda authentication complete
			</div>
		);
	}

	return (
		<Card className="my-2 max-w-xl" data-qa-id="anaconda-auth-tool-card">
			<CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
				<AnacondaLogo className="row-span-2 size-8 text-(--color-green-700)" />
				<CardTitle>{copy.title}</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p className="text-muted-foreground text-sm leading-relaxed">{copy.description}</p>
				<div className="flex items-center gap-2">
					<Button type="button" disabled={submitting || !gate} onClick={() => void signIn()}>
						{submitting ? (
							<>
								<Spinner data-icon="inline-start" aria-hidden="true" />
								Signing in…
							</>
						) : (
							<>
								Sign in to Anaconda
								<ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
							</>
						)}
					</Button>
					<Button
						type="button"
						variant="ghost"
						onClick={() => gate?.cancel()}
						disabled={submitting}
					>
						Cancel
					</Button>
				</div>
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
