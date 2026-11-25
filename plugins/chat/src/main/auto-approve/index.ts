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
	needsPerson,
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

/**
 * How long a resolved request stays in `holding`: long enough for each
 * window's own stream to drop it first, short enough that a window which
 * missed the resolve shows the card soon instead of hiding it for good.
 */
const DROP_RESOLVED_AFTER_MS = 1_000;

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
 * - A request it has decided to answer is in `holding` (cards hide it) until
 *   the reply fails or `PERMISSION_AUTO_ANSWER_TIMEOUT_MS` passes. One that
 *   resolves stays listed for `DROP_RESOLVED_AFTER_MS` (see `dropResolved`). A request is not held
 *   while it is read: the windows already hide, for a while, those they
 *   predict it will answer, and holding the rest would hide prompts a person
 *   must answer.
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
export function activateAutoApprove(sdk: PluginSdk): void {
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
			setTimeout(() => release(permissionId), PERMISSION_AUTO_ANSWER_TIMEOUT_MS),
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

	/**
	 * Lets go of a resolved request after `DROP_RESOLVED_AFTER_MS`. Each window
	 * drops it on its own stream; a `holding` update arriving first would show
	 * its card in place of the composer for a moment.
	 */
	function dropResolved(permissionId: string): void {
		const timer = held.get(permissionId);
		if (timer === undefined) return;
		clearTimeout(timer);
		held.set(
			permissionId,
			setTimeout(() => release(permissionId), DROP_RESOLVED_AFTER_MS),
		);
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
		try {
			const request = await requestOf(handle, chatId, permissionId);
			// The mode changed while reading: what was decided for it no longer holds.
			if (generation !== snapshot) return;
			if (!request || needsPerson(request)) return;
			if (
				!auto &&
				(sdk.context.get(SIGNED_IN_KEY) || !request.toolKey || !signInTools().has(request.toolKey))
			) {
				return;
			}
			hold(permissionId);
			await handle.methods.replyPermission({ chatId, permissionId, decision: "once" });
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
				// Serial on purpose: a mode change bumps `generation` and must stop the drain mid-way.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
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
				handle.on("permission-resolved", ({ permissionId }) => dropResolved(permissionId)),
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
