import { useAui, useAuiState } from "@assistant-ui/react";
import { CircleCheckIcon, CircleSlashIcon, ShieldCheckIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FC, type ReactNode } from "react";

import type { ToolSignInPrompt } from "@kilo-desktop/feature-sdk";
import type { KiloServerWebCapabilities } from "@kilo-desktop/plugin-kilo-server/contracts";
import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { useKiloAuth } from "../../../account/KiloAuthContext.js";
import { useChatConnection } from "../../connection/ChatConnectionContext.js";
import { useChatModelSelection } from "../../model-selection/ChatModelSelectionContext.js";
import { useOptionalOpenCodeRuntimeExtras } from "../../runtime/use-optional-opencode-runtime-extras.js";
import { tellAgentToolsAvailable } from "./tell-agent-tools-available.js";
import { findSignInTool, signInRefusalOf, toolSignInPrompt } from "./tool-sign-in.js";

const CONTINUE_AFTER_SIGN_IN = "I've signed in. Please continue.";
const continueWithoutSignIn = (toolsLabel: string) =>
	`I'd rather not sign in for now. Please continue without ${toolsLabel}.`;
const useToolsAgain = (toolsLabel: string) =>
	`I've signed in, so please use ${toolsLabel} again instead of running the equivalent ` +
	"commands in the terminal.";

const CARD_CLASS =
	"border-border bg-background my-2 flex flex-col gap-3 rounded-md border p-3 text-sm";
const ROW_CLASS =
	"border-border bg-background my-2 flex items-center justify-between gap-3 rounded-md border p-3 text-sm";

type FollowUp = "after-sign-in" | "without-sign-in";

/**
 * Follow-up messages owed to the agent, by tool call: the refused call already
 * ended, so after the user answers the prompt chat continues the conversation
 * for them. Module-level so a card remounting (sign-in resets the Kilo runtime
 * and re-renders the thread) does not forget it; per window, so only the
 * window where the user answered sends it.
 */
const pendingFollowUps = new Map<string, FollowUp>();

/**
 * Main-owned sign-in gating state for one feature's agent tools (`scope`, the
 * refused tool's feature id), and the decline action for that feature.
 */
function useAgentToolSignIn(scope: string): { declined: boolean; decline: () => Promise<void> } {
	const sdk = useSdk("kilo-ui");
	const capability = sdk.plugins.get<KiloServerWebCapabilities>("kilo-server")?.agentToolSignIn;
	const [declined, setDeclined] = useState(false);
	useEffect(() => {
		if (!capability) return;
		let live = true;
		capability
			.getState()
			.then((state) => {
				if (live) setDeclined(state.declined.includes(scope));
			})
			.catch(() => undefined);
		const unsubscribe = capability.subscribe((state) =>
			setDeclined(state.declined.includes(scope)),
		);
		return () => {
			live = false;
			unsubscribe();
		};
	}, [capability, scope]);
	const decline = useCallback(async () => {
		if (!capability) return;
		const state = await capability.decline(scope);
		setDeclined(state.declined.includes(scope));
	}, [capability, scope]);
	return { declined, decline };
}

/**
 * Whether a turn sent now would run for the signed-in user. Sign-in reports
 * the user as signed in before it refreshes the model catalog, and a turn sent
 * in between still carries the signed-out model (e.g. `kilo-auto/free`) and
 * fails. So also wait for the sign-in flow to finish and the catalog to settle
 * on a model.
 */
function useReadyAfterSignIn(): boolean {
	const auth = useKiloAuth();
	const { model, isCatalogPending, isCatalogFetching } = useChatModelSelection();
	return (
		auth.authenticated === true &&
		auth.deviceAuth.status === "idle" &&
		!isCatalogPending &&
		isCatalogFetching !== true &&
		model !== undefined
	);
}

/**
 * Renders a tool call in place of its normal UI when the tool gateway refused
 * it for sign-in: the sign-in prompt, or a note that the tools are off because
 * the user declined. Wording comes from the refused tool's own prompt. Anything
 * else renders `children` unchanged.
 */
export const ToolCallSignInGate: FC<{
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean | undefined;
	children: ReactNode;
}> = ({ toolCallId, toolName, result, isError, children }) => {
	const { tools } = useSdk("kilo-ui");
	const refusal = signInRefusalOf({ toolName, result, isError });
	// Only a registered sign-in tool can be refused by the gateway; any other
	// tool's error may merely echo the marker, and the card's "Not now"
	// changes a gate shared by every agent. The decline is scoped to the
	// refused tool's feature, so other features' gated tools keep asking.
	const signInTool = refusal ? findSignInTool(tools.all(), toolName) : undefined;
	if (!refusal || !signInTool) return children;
	return (
		<RefusedToolCall
			toolCallId={toolCallId}
			scope={signInTool.featureId}
			prompt={toolSignInPrompt(signInTool)}
			declinedResult={refusal === "declined"}
		/>
	);
};

const RefusedToolCall: FC<{
	toolCallId: string;
	scope: string;
	prompt: ToolSignInPrompt;
	declinedResult: boolean;
}> = ({ toolCallId, scope, prompt, declinedResult }) => {
	const auth = useKiloAuth();
	const aui = useAui();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const { declined, decline } = useAgentToolSignIn(scope);
	const signedIn = auth.authenticated === true;
	const ready = useReadyAfterSignIn();

	useEffect(() => {
		const followUp = pendingFollowUps.get(toolCallId);
		if (!followUp || isRunning) return;
		if (followUp === "after-sign-in" && !ready) return;
		pendingFollowUps.delete(toolCallId);
		aui
			.thread()
			.append(
				followUp === "after-sign-in"
					? CONTINUE_AFTER_SIGN_IN
					: continueWithoutSignIn(prompt.toolsLabel),
			);
		// `declined` and `ready` are what change once the user has answered.
	}, [aui, declined, isRunning, prompt.toolsLabel, ready, toolCallId]);

	useEffect(() => {
		if (declined) declinedCalls.add(toolCallId);
	}, [declined, toolCallId]);

	if (declinedResult || declined || declinedCalls.has(toolCallId)) {
		return <SignInDeclinedNote toolCallId={toolCallId} toolsLabel={prompt.toolsLabel} />;
	}
	if (signedIn) return <SignedInAfterRefusal />;
	return (
		<SignInPrompt
			prompt={prompt}
			onSignIn={() => {
				pendingFollowUps.set(toolCallId, "after-sign-in");
				auth.login();
			}}
			onDecline={() => {
				pendingFollowUps.set(toolCallId, "without-sign-in");
				declinedCalls.add(toolCallId);
				void decline().catch(() => {
					pendingFollowUps.delete(toolCallId);
					declinedCalls.delete(toolCallId);
				});
			}}
		/>
	);
};

const SignInPrompt: FC<{
	prompt: ToolSignInPrompt;
	onSignIn: () => void;
	onDecline: () => void;
}> = ({ prompt, onSignIn, onDecline }) => {
	const auth = useKiloAuth();
	const signingIn =
		auth.deviceAuth.status === "initiating" ||
		auth.deviceAuth.status === "waiting" ||
		auth.deviceAuth.status === "finishing";
	return (
		<div
			role="group"
			aria-label={prompt.title}
			className={CARD_CLASS}
			data-qa-id="kilo-tool-signin-prompt"
		>
			<div className="flex items-start gap-2">
				<ShieldCheckIcon className="text-primary-ink mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<div className="flex min-w-0 flex-col gap-1">
					<span className="font-medium">{prompt.title}</span>
					<span className="text-muted-foreground">{prompt.body}</span>
				</div>
			</div>
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={onDecline}
					disabled={signingIn}
					data-qa-id="kilo-tool-signin-prompt-decline"
				>
					Not now
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={onSignIn}
					disabled={signingIn || auth.canSignIn === false}
					data-qa-id="kilo-tool-signin-prompt-signin"
				>
					{signingIn ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
					{signingIn ? "Signing in…" : "Sign in"}
				</Button>
			</div>
		</div>
	);
};

/** Signed in since the call was refused (e.g. from Settings): offer to continue. */
const SignedInAfterRefusal: FC = () => {
	const aui = useAui();
	const ready = useReadyAfterSignIn();
	const canContinue = useAuiState((s) => s.message.isLast && !s.thread.isRunning) && ready;
	return (
		<div role="status" className={ROW_CLASS} data-qa-id="kilo-tool-signin-signed-in">
			<span className="flex min-w-0 items-center gap-2">
				<CircleCheckIcon className="text-primary-ink size-4 shrink-0" aria-hidden="true" />
				<span>You&rsquo;re signed in. The agent can use this tool now.</span>
			</span>
			{canContinue ? (
				<Button
					type="button"
					size="sm"
					onClick={() => {
						aui.thread().append(CONTINUE_AFTER_SIGN_IN);
					}}
					data-qa-id="kilo-tool-signin-continue"
				>
					Continue
				</Button>
			) : null}
		</div>
	);
};

const STORED_CALL_IDS_LIMIT = 200;

/** A set of tool call ids kept in localStorage, so it survives restarts. */
function storedCallIds(storageKey: string) {
	const read = (): string[] => {
		try {
			const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
			return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
		} catch {
			return [];
		}
	};
	const write = (ids: string[]): void => {
		try {
			localStorage.setItem(storageKey, JSON.stringify(ids.slice(-STORED_CALL_IDS_LIMIT)));
		} catch {
			// Storage unavailable: the set only lasts for this render.
		}
	};
	return {
		has: (toolCallId: string): boolean => read().includes(toolCallId),
		add: (toolCallId: string): void => {
			if (!read().includes(toolCallId)) write([...read(), toolCallId]);
		},
		delete: (toolCallId: string): void => write(read().filter((id) => id !== toolCallId)),
	};
}

/**
 * Refused calls the user declined sign-in for. Main forgets a decline once the
 * user signs in, but this chat still has to tell the agent the tools are back.
 */
const declinedCalls = storedCallIds("kilo-ui.agent-tool-sign-in.declined-calls");
/** Declined calls whose session was already told the tools are back. */
const toldAvailable = storedCallIds("kilo-ui.agent-tool-sign-in.told-available");

/**
 * Once the user is signed in, tell the agent in this chat's session that the
 * declined tools are back, once per declined call. Runs wherever the user
 * signed in (prompt, Settings), as soon as this chat shows the declined call
 * and the agent is not mid-turn.
 */
function useTellAgentToolsAvailable(toolCallId: string, toolsLabel: string, ready: boolean) {
	const session = useOptionalOpenCodeRuntimeExtras()?.session ?? null;
	const { connection } = useChatConnection();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const sessionID = session?.id;
	const directory = session?.directory;
	useEffect(() => {
		if (!ready || isRunning || !connection || !sessionID || !directory) return;
		if (toldAvailable.has(toolCallId)) return;
		toldAvailable.add(toolCallId);
		tellAgentToolsAvailable({ connection, sessionID, directory, toolsLabel }).catch(() =>
			toldAvailable.delete(toolCallId),
		);
	}, [connection, directory, isRunning, ready, sessionID, toolCallId, toolsLabel]);
}

/**
 * The user declined, so the agent carried on without the tools. Once they sign
 * in the tools come back, but the agent's history says they are off, so offer
 * to tell it to switch back.
 */
const SignInDeclinedNote: FC<{ toolCallId: string; toolsLabel: string }> = ({
	toolCallId,
	toolsLabel,
}) => {
	const auth = useKiloAuth();
	const aui = useAui();
	const ready = useReadyAfterSignIn();
	const canAsk = useAuiState((s) => !s.thread.isRunning) && ready;
	useTellAgentToolsAvailable(toolCallId, toolsLabel, ready);

	if (auth.authenticated === true) {
		return (
			<div role="status" className={ROW_CLASS} data-qa-id="kilo-tool-signin-declined-signed-in">
				<span className="flex min-w-0 items-center gap-2">
					<CircleCheckIcon className="text-primary-ink size-4 shrink-0" aria-hidden="true" />
					<span>You&rsquo;re signed in. The agent can use {toolsLabel} again.</span>
				</span>
				{canAsk ? (
					<Button
						type="button"
						size="sm"
						onClick={() => {
							aui.thread().append(useToolsAgain(toolsLabel));
						}}
						data-qa-id="kilo-tool-signin-use-tools"
					>
						Use them now
					</Button>
				) : null}
			</div>
		);
	}
	return (
		<div role="status" className={ROW_CLASS} data-qa-id="kilo-tool-signin-declined">
			<span className="text-muted-foreground flex min-w-0 items-center gap-2">
				<CircleSlashIcon className="size-4 shrink-0" aria-hidden="true" />
				<span>
					You chose not to sign in, so the agent won&rsquo;t use {toolsLabel} until you do.
				</span>
			</span>
		</div>
	);
};
