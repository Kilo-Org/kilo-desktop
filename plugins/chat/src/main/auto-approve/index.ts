import {
	KERNEL_OWNER,
	KernelError,
	mainHost,
	type DomainObjectCaller,
	type DomainObjectHandle,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import {
	Chats,
	Tool,
	ToolApproval,
	type PermissionRequest,
} from "@kilo-desktop/plugin-core/contracts";
import { PERMISSION_AUTO_ANSWER_TIMEOUT_MS } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	AUTO_APPROVE_TOOL_APPROVAL_ID,
	AutoApprove,
	CHAT_PLUGIN_ID,
	neverAutoReplied,
	type ApprovalMode,
} from "../../contracts";

const SIGNED_IN_KEY = "kilo.core/signedIn";

/**
 * The saved mode. Origin's value used to be handed over by `importLegacyMode`,
 * marked by `importedFromOrigin`; a window hands it over with `setMode` now,
 * and the old marker is left as it was (unread).
 */
interface PersistedMode extends Record<string, unknown> {
	mode: ApprovalMode;
}

type ChatsHandle = DomainObjectHandle<typeof Chats>;

export interface AutoApproveOptions {
	readonly revealAfterMs?: number;
}

/**
 * The `auto-approve` domain object: origin's renderer auto-approver, moved to
 * main so one place answers every chat's requests, whichever window shows
 * them, or none.
 *
 * - **Auto:** each `permission-requested` is answered "once". Requests already
 *   pending are drained when Auto turns on and whenever kilo.core's chat list
 *   becomes ready (start, reconnect). Sandbox escalation, protected-config and
 *   skill-shell prompts are left for a person (the server refuses machine
 *   replies to skill-shell anyway).
 * - **Manual:** one kind is still answered: a call to a `requiresSignIn` tool
 *   while signed out. The gateway will refuse it, so asking first only puts
 *   Kilo's prompt before (or, if denied, instead of) chat's sign-in prompt.
 * - A request being answered or checked is in `holding` (cards hide it) until
 *   it resolves, the reply fails, or `revealAfterMs` passes.
 * - `generation` changes with the mode, so a drain stops when the mode does.
 * - The mode is app-wide, as origin's was, in kv (namespace `auto-approve`,
 *   unchanged since the previous kilo.chat).
 * - kilo.chat's `kilo.core/tool-approval` contribution lets desktop tools
 *   proceed: it is asked once per tool when a chat is created, and the mode
 *   can change during the chat's life, so turning a tool into an ask or a
 *   deny there would outlive the mode. Asks a tool makes on its own
 *   (`approval: "ask"`) still reach this auto-approver, which answers them
 *   in Auto.
 */
export function activateAutoApprove(sdk: PluginSdk, options: AutoApproveOptions = {}): void {
	const revealAfterMs = options.revealAfterMs ?? PERMISSION_AUTO_ANSWER_TIMEOUT_MS;
	const store = mainHost(sdk).storage.kv<PersistedMode>({
		namespace: "auto-approve",
		defaults: { mode: "manual" },
	});
	const held = new Map<string, ReturnType<typeof setTimeout>>();
	let generation = 0;
	let chats: ChatsHandle | null = null;

	// Auto answers the agent's permission requests for the person, so only
	// kilo.chat's own control (and the kernel) may turn it on.
	const chatOrKernelOnly = (caller: DomainObjectCaller) => {
		const kernel = caller.pluginId === KERNEL_OWNER && caller.process === "main";
		if (caller.pluginId !== CHAT_PLUGIN_ID && !kernel) {
			throw new KernelError("PERMISSION_DENIED", "Only kilo.chat can change auto-approve.");
		}
	};

	const provider = sdk.domainObjects.provide(AutoApprove, {
		initialState: { mode: store.get("mode") === "auto" ? "auto" : "manual", holding: [] },
		methods: {
			setMode: ({ mode }, caller) => {
				chatOrKernelOnly(caller);
				setMode(mode);
			},
		},
	});

	sdk.extensions.implement(ToolApproval, AUTO_APPROVE_TOOL_APPROVAL_ID, () => "proceed");

	function setMode(mode: ApprovalMode): void {
		store.set({ mode });
		if (mode === provider.state.mode) return;
		generation += 1;
		provider.setState({ ...provider.state, mode });
		if (mode === "auto") void drain(generation);
	}

	function publishHolding(): void {
		provider.setState({ ...provider.state, holding: [...held.keys()] });
	}

	function hold(permissionId: string): void {
		if (held.has(permissionId)) return;
		held.set(
			permissionId,
			setTimeout(() => release(permissionId), revealAfterMs),
		);
		publishHolding();
	}

	function release(permissionId: string): void {
		const timer = held.get(permissionId);
		if (timer === undefined) return;
		clearTimeout(timer);
		held.delete(permissionId);
		publishHolding();
	}

	/** Contribution keys of the `kilo.core/tool`s refused while signed out. */
	function signInTools(): Set<string> {
		return new Set(
			sdk.extensions
				.list(Tool)
				.filter((tool) => tool.metadata.requiresSignIn)
				.map((tool) => tool.key),
		);
	}

	async function requestOf(
		handle: ChatsHandle,
		chatId: string,
		permissionId: string,
	): Promise<PermissionRequest | undefined> {
		const requests = await handle.methods.permissionRequests({ id: chatId });
		return requests.find((request) => request.id === permissionId);
	}

	async function consider(chatId: string, permissionId: string): Promise<void> {
		const handle = chats;
		if (!handle) return;
		const auto = provider.state.mode === "auto";
		if (!auto && (sdk.context.get(SIGNED_IN_KEY) || signInTools().size === 0)) return;
		const snapshot = generation;
		hold(permissionId);
		try {
			const request = await requestOf(handle, chatId, permissionId);
			// The mode changed while reading: what was decided for it no longer holds.
			if (generation !== snapshot) return release(permissionId);
			if (!request || neverAutoReplied(request.metadata)) return release(permissionId);
			if (auto) {
				if (request.metadata["skillShell"] === true) release(permissionId);
			} else if (
				request.metadata["skillShell"] === true ||
				sdk.context.get(SIGNED_IN_KEY) ||
				!request.toolKey ||
				!signInTools().has(request.toolKey)
			) {
				return release(permissionId);
			}
			await handle.methods.replyPermission({ chatId, permissionId, reply: "once" });
		} catch (error) {
			sdk.logger.warn(`Could not answer permission request ${permissionId} for the person`, error);
			release(permissionId);
		}
	}

	async function drain(snapshot: number): Promise<void> {
		const handle = chats;
		if (!handle || provider.state.mode !== "auto" || !handle.getState().ready) return;
		for (const chat of Object.values(handle.getState().chats)) {
			for (const permissionId of chat.activity.pendingPermissionIds) {
				if (generation !== snapshot) return;
				await consider(chat.id, permissionId);
			}
		}
	}

	let stopTracking = () => {};
	sdk.domainObjects.track(Chats, {
		added: (handle) => {
			chats = handle;
			let ready = handle.getState().ready;
			const stops = [
				handle.on("permission-requested", ({ chatId, permissionId }) => {
					void consider(chatId, permissionId);
				}),
				handle.on("permission-resolved", ({ permissionId }) => release(permissionId)),
				handle.subscribe((state) => {
					if (state.ready && !ready) void drain(generation);
					ready = state.ready;
				}),
			];
			if (ready) void drain(generation);
			stopTracking = () => {
				for (const stop of stops) stop();
			};
		},
		removed: () => {
			stopTracking();
			chats = null;
			for (const permissionId of [...held.keys()]) release(permissionId);
		},
	});
	sdk.onDispose(() => {
		generation += 1;
		for (const timer of held.values()) clearTimeout(timer);
		held.clear();
	});
}
