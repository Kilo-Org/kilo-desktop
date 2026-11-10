import { useAui, useAuiState } from "@assistant-ui/react";
import { CircleCheckIcon, CircleSlashIcon, ShieldCheckIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FC, type ReactNode } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	Chats,
	KiloAccount,
	Tool,
	toolWireName,
	type AccountState,
} from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { useOptionalExtensions } from "../optional-extensions";
import { useOptionalChatModelSelection } from "../selection/ChatModelSelectionContext";
import { useKiloSignIn } from "../selection/use-kilo-sign-in";
import {
	DEFAULT_TOOL_SIGN_IN_PROMPT,
	signInRefusalKind,
	type ToolSignInPrompt,
} from "./tool-sign-in";

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
 * Follow-ups owed to the agent, by tool call: the refused call already ended,
 * so once the person answers the card chat continues the conversation for
 * them. Module-level so a card remounting does not forget it; per window, so
 * only the window where the person answered sends it.
 */
const pendingFollowUps = new Map<string, FollowUp>();

const STORED_CALL_IDS_LIMIT = 200;
const DECLINED_CALLS_KEY = "kilo.chat.tool-sign-in.declined-calls";
/** Origin's kilo-ui kept the same list here; read, never written, so a downgrade still finds it. */
const ORIGIN_DECLINED_CALLS_KEY = "kilo-ui.agent-tool-sign-in.declined-calls";

function readCallIds(key: string): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Refused calls the person chose not to sign in for, in localStorage so the
 * card keeps saying so after a restart, when kilo.core has forgotten the
 * decline (it keeps declines in memory, until sign-in or restart).
 */
const declinedCalls = {
	read(): string[] {
		return readCallIds(DECLINED_CALLS_KEY);
	},
	has(toolCallId: string): boolean {
		return (
			this.read().includes(toolCallId) ||
			readCallIds(ORIGIN_DECLINED_CALLS_KEY).includes(toolCallId)
		);
	},
	add(toolCallId: string): void {
		const ids = this.read();
		if (ids.includes(toolCallId)) return;
		try {
			localStorage.setItem(
				DECLINED_CALLS_KEY,
				JSON.stringify([...ids, toolCallId].slice(-STORED_CALL_IDS_LIMIT)),
			);
		} catch {
			// Storage unavailable: the answer only lasts while the card is shown.
		}
	},
};

const selectSignedIn = (state: AccountState) => state.signedIn === true;
const selectSigningIn = (state: AccountState) =>
	state.deviceSignIn.status === "initiating" ||
	state.deviceSignIn.status === "waiting" ||
	state.deviceSignIn.status === "finishing";
const selectSignInIdle = (state: AccountState) => state.deviceSignIn.status === "idle";
const selectCanSignIn = (state: AccountState) => state.connection === "connected";

/**
 * Whether a turn sent now would run for the signed-in person. Sign-in reports
 * them signed in before the model catalog refreshes, and a turn sent in
 * between still carries the signed-out model; so also wait for the flow to
 * finish and the catalog to settle on a model. A catalog that failed to load
 * leaves the signed-out model selected unchecked, so it does not count.
 */
function useReadyAfterSignIn(): boolean {
	const signedIn = useDomainObjectState(KiloAccount, selectSignedIn) ?? false;
	const idle = useDomainObjectState(KiloAccount, selectSignInIdle) ?? true;
	const selection = useOptionalChatModelSelection();
	const catalogSettled =
		!selection ||
		(!selection.isCatalogError &&
			!selection.isCatalogPending &&
			selection.isCatalogFetching !== true &&
			selection.model !== undefined);
	return signedIn && idle && catalogSettled;
}

interface SignInTool {
	readonly prompt: ToolSignInPrompt;
	/** The contributing plugin: declining withdraws its sign-in tools together. */
	readonly scope: string;
}

/** `toolName` when it is one of the app's agent tools that need sign-in. */
function useSignInTool(toolName: string): SignInTool | undefined {
	const tools = useOptionalExtensions(Tool);
	const tool = tools.find(
		(candidate) => candidate.metadata.requiresSignIn && toolWireName(candidate.key) === toolName,
	);
	return tool
		? {
				prompt: tool.metadata.signInPrompt ?? DEFAULT_TOOL_SIGN_IN_PROMPT,
				scope: tool.pluginId,
			}
		: undefined;
}

/**
 * Whether the person went without `scope`'s sign-in tools, as kilo.core's
 * gateway keeps it for every agent, and the decline that withdraws them.
 */
function useToolSignInDecline(scope: string): { declined: boolean; decline: () => void } {
	const chats = useDomainObject(Chats);
	const selectDeclined = useCallback(
		(state: DomainObjectState<typeof Chats>) => state.declinedSignInTools.includes(scope),
		[scope],
	);
	const declined = useDomainObjectState(Chats, selectDeclined) ?? false;
	const decline = useCallback(() => {
		// A failed decline leaves the tools listed; the agent was still told to go without them.
		void chats?.methods.declineSignInTools({ pluginId: scope }).catch(() => undefined);
	}, [chats, scope]);
	return { declined, decline };
}

/**
 * Renders a tool call in place of its normal UI when kilo.core's gateway
 * refused it because the person is signed out (its `[desktop:sign-in-required]`
 * marker): a sign-in card, then a note once they answer. Anything else
 * renders `children`.
 */
export const ToolCallSignInGate: FC<{
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean | undefined;
	children: ReactNode;
}> = ({ toolCallId, toolName, result, isError, children }) => {
	// Only one of the app's sign-in tools can be refused for sign-in; any other
	// tool's error may merely echo the marker.
	const tool = useSignInTool(toolName);
	const refusal = signInRefusalKind({ toolName, result, isError });
	if (!tool || !refusal) return children;
	return (
		<RefusedToolCall
			toolCallId={toolCallId}
			prompt={tool.prompt}
			scope={tool.scope}
			refusedAsDeclined={refusal === "declined"}
		/>
	);
};

const RefusedToolCall: FC<{
	toolCallId: string;
	prompt: ToolSignInPrompt;
	scope: string;
	/** The gateway refused it because the person had already declined. */
	refusedAsDeclined: boolean;
}> = ({ toolCallId, prompt, scope, refusedAsDeclined }) => {
	const aui = useAui();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const signedIn = useDomainObjectState(KiloAccount, selectSignedIn) ?? false;
	const ready = useReadyAfterSignIn();
	const { signIn } = useKiloSignIn();
	const toolSignIn = useToolSignInDecline(scope);
	const [declinedHere, setDeclinedHere] = useState(() => declinedCalls.has(toolCallId));
	const declined = declinedHere || toolSignIn.declined || refusedAsDeclined;

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
		// `declined` and `ready` are what change once the person has answered.
	}, [aui, declined, isRunning, prompt.toolsLabel, ready, toolCallId]);

	useEffect(() => {
		if (toolSignIn.declined) declinedCalls.add(toolCallId);
	}, [toolSignIn.declined, toolCallId]);

	if (declined) return <SignInDeclinedNote toolsLabel={prompt.toolsLabel} />;
	if (signedIn) return <SignedInAfterRefusal />;
	return (
		<SignInPrompt
			prompt={prompt}
			onSignIn={() => {
				pendingFollowUps.set(toolCallId, "after-sign-in");
				signIn();
			}}
			onDecline={() => {
				pendingFollowUps.set(toolCallId, "without-sign-in");
				declinedCalls.add(toolCallId);
				setDeclinedHere(true);
				toolSignIn.decline();
			}}
		/>
	);
};

const SignInPrompt: FC<{
	prompt: ToolSignInPrompt;
	onSignIn: () => void;
	onDecline: () => void;
}> = ({ prompt, onSignIn, onDecline }) => {
	const signingIn = useDomainObjectState(KiloAccount, selectSigningIn) ?? false;
	const canSignIn = useDomainObjectState(KiloAccount, selectCanSignIn) ?? false;
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
					disabled={signingIn || !canSignIn}
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

/**
 * The person chose not to sign in, so the agent carried on without the
 * tools. Once they sign in its history still says the tools are off, so
 * offer to tell it to use them again.
 */
const SignInDeclinedNote: FC<{ toolsLabel: string }> = ({ toolsLabel }) => {
	const aui = useAui();
	const signedIn = useDomainObjectState(KiloAccount, selectSignedIn) ?? false;
	const ready = useReadyAfterSignIn();
	const canAsk = useAuiState((s) => !s.thread.isRunning) && ready;

	if (signedIn) {
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
