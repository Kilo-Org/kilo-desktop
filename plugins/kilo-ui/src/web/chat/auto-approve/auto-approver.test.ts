import type { OpenCodeServerEvent } from "@assistant-ui/react-opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import { createAutoApprover, needsPerson } from "./auto-approver.js";

vi.mock("../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(),
}));

const connection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "7.7.6",
	globalDirectory: "/runtime",
};

function asked(
	properties: Record<string, unknown>,
	extra: Partial<OpenCodeServerEvent> = {},
): OpenCodeServerEvent {
	return {
		type: "permission.asked",
		properties,
		sessionId: properties["sessionID"] as string | undefined,
		directory: "/workspace",
		raw: undefined,
		...extra,
	};
}

function replied(requestID: string): OpenCodeServerEvent {
	return {
		type: "permission.replied",
		properties: { requestID, sessionID: "ses-1" },
		sessionId: "ses-1",
		directory: "/workspace",
		raw: undefined,
	};
}

function setup(
	options: {
		enabled?: boolean;
		directories?: string[];
		isRefusedForSignIn?: (permission: string) => Promise<boolean>;
	} = {},
) {
	let enabled = options.enabled ?? true;
	// Each fake client is bound to its directory, like the real directory-scoped client.
	const reply = vi.fn(async (_directory: string, _body: Record<string, unknown>) => ({
		data: true,
	}));
	const list = vi.fn(async (_directory: string) => ({ data: [] as unknown[] }));
	const onReveal = vi.fn();
	vi.mocked(createKiloDirectoryClient).mockImplementation(
		(_connection, directory) =>
			({
				permission: {
					reply: (body: Record<string, unknown>) => reply(directory, body),
					list: () => list(directory),
				},
			}) as never,
	);
	const approver = createAutoApprover({
		getConnection: async () => connection,
		isEnabled: () => enabled,
		resolveDirectory: (sessionId) => (sessionId === "known" ? "/workspace/known" : undefined),
		directories: () => options.directories ?? [],
		onReveal,
		revealAfterMs: 1_000,
		...(options.isRefusedForSignIn ? { isRefusedForSignIn: options.isRefusedForSignIn } : {}),
	});
	const revealedIds = () => [...approver.revealedIds.getState().ids];
	const checkingIds = () => [...approver.checkingIds.getState().ids];
	return {
		checkingIds,
		approver,
		reply,
		list,
		onReveal,
		revealedIds,
		setEnabled: (next: boolean) => {
			enabled = next;
			return approver.setEnabled(next);
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("needsPerson", () => {
	it("flags prompts auto-approve never answers", () => {
		expect(needsPerson({ sandboxEscalation: true })).toBe(true);
		expect(needsPerson({ skillShell: true })).toBe(true);
		expect(needsPerson({ configProtected: true })).toBe(true);
		expect(needsPerson({})).toBe(false);
		expect(needsPerson(undefined)).toBe(false);
	});
});

describe("createAutoApprover", () => {
	it("holds an asked permission back and replies once from the event alone, without interactive", async () => {
		const { approver, reply, list, revealedIds } = setup();

		expect(
			approver.handleEvent(
				asked({ id: "perm-1", sessionID: "ses-1" }, { directory: "/workspace/events" }),
			),
		).toBe(true);

		await vi.waitFor(() =>
			expect(reply).toHaveBeenCalledExactlyOnceWith("/workspace/events", {
				requestID: "perm-1",
				reply: "once",
			}),
		);
		expect(list).not.toHaveBeenCalled();
		expect(revealedIds()).toEqual([]);
	});

	it("drops the held event without revealing it once the reply lands", async () => {
		vi.useFakeTimers();
		const { approver, onReveal, revealedIds } = setup();

		approver.handleEvent(asked({ id: "perm-1", sessionID: "ses-1" }));
		expect(approver.handleEvent(replied("perm-1"))).toBe(false);
		await vi.advanceTimersByTimeAsync(5_000);

		expect(onReveal).not.toHaveBeenCalled();
		expect(revealedIds()).toEqual([]);
	});

	it("reveals the request and hands back the held event when the reply fails", async () => {
		const { approver, reply, onReveal, revealedIds } = setup();
		reply.mockRejectedValueOnce(new Error("server down"));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const event = asked({ id: "perm-1", sessionID: "ses-1" });

		approver.handleEvent(event);

		await vi.waitFor(() => expect(onReveal).toHaveBeenCalledExactlyOnceWith(event));
		expect(revealedIds()).toEqual(["perm-1"]);
	});

	it("reveals the held event when no reply confirmation arrives in time", async () => {
		vi.useFakeTimers();
		const { approver, onReveal, revealedIds } = setup();
		const event = asked({ id: "perm-1", sessionID: "ses-1" });

		approver.handleEvent(event);
		await vi.advanceTimersByTimeAsync(999);
		expect(onReveal).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);

		expect(onReveal).toHaveBeenCalledExactlyOnceWith(event);
		expect(revealedIds()).toEqual(["perm-1"]);
	});

	it("reveals a request it cannot answer because its directory is unknown", () => {
		const { approver, reply, revealedIds } = setup();

		expect(
			approver.handleEvent(asked({ id: "lost", sessionID: "ses-9" }, { directory: undefined })),
		).toBe(false);

		expect(revealedIds()).toEqual(["lost"]);
		expect(reply).not.toHaveBeenCalled();
	});

	it("replies to skill-shell prompts without holding them back, since the server ignores the reply", async () => {
		const { approver, reply } = setup();

		expect(
			approver.handleEvent(
				asked({ id: "skill", sessionID: "ses-1", metadata: { skillShell: true } }),
			),
		).toBe(false);

		await vi.waitFor(() => expect(reply).toHaveBeenCalledOnce());
	});

	it("falls back to the session's known directory when the event has none", async () => {
		const { approver, reply } = setup();

		approver.handleEvent(asked({ id: "perm-1", sessionID: "known" }, { directory: undefined }));

		await vi.waitFor(() =>
			expect(reply).toHaveBeenCalledWith("/workspace/known", {
				requestID: "perm-1",
				reply: "once",
			}),
		);
	});

	it("leaves sandbox escalation, protected-config, and manual-mode prompts to a person", async () => {
		const { approver, reply, revealedIds, setEnabled } = setup();

		expect(
			approver.handleEvent(
				asked({ id: "sandbox", sessionID: "ses-1", metadata: { sandboxEscalation: true } }),
			),
		).toBe(false);
		expect(
			approver.handleEvent(
				asked({ id: "config", sessionID: "ses-1", metadata: { configProtected: true } }),
			),
		).toBe(false);
		await setEnabled(false);
		expect(approver.handleEvent(asked({ id: "perm-1", sessionID: "ses-1" }))).toBe(false);

		expect(revealedIds()).toEqual([]);
		expect(reply).not.toHaveBeenCalled();
	});

	it("drains already-pending requests across known directories when enabled", async () => {
		const { reply, list, setEnabled } = setup({
			enabled: false,
			directories: ["/workspace/a", "/workspace/b", "/workspace/a"],
		});
		list.mockImplementation(async (directory) => ({
			data:
				directory === "/workspace/a"
					? [
							{ id: "a-1", sessionID: "ses-a" },
							{ id: "a-sandbox", sessionID: "ses-a", metadata: { sandboxEscalation: true } },
							{ id: "a-config", sessionID: "ses-a", metadata: { configProtected: true } },
						]
					: [{ id: "b-1", sessionID: "ses-b" }],
		}));

		await setEnabled(true);

		expect(list).toHaveBeenCalledTimes(2);
		expect(reply.mock.calls).toEqual([
			["/workspace/a", { requestID: "a-1", reply: "once" }],
			["/workspace/b", { requestID: "b-1", reply: "once" }],
		]);
	});

	it("resyncs pending requests while Auto is on, and does nothing in manual mode", async () => {
		const { approver, reply, list, setEnabled } = setup({ directories: ["/workspace/a"] });
		list.mockResolvedValue({ data: [{ id: "a-1", sessionID: "ses-a" }] });

		await approver.resync();
		expect(reply).toHaveBeenCalledExactlyOnceWith("/workspace/a", {
			requestID: "a-1",
			reply: "once",
		});

		await setEnabled(false);
		list.mockClear();
		reply.mockClear();
		await approver.resync();
		expect(list).not.toHaveBeenCalled();
		expect(reply).not.toHaveBeenCalled();
	});

	it("stops an in-flight drain when switched back to manual", async () => {
		const { reply, list, setEnabled } = setup({
			enabled: false,
			directories: ["/workspace/a", "/workspace/b"],
		});
		let releaseList!: () => void;
		list.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseList = () => resolve({ data: [{ id: "a-1", sessionID: "ses-a" }] });
				}),
		);

		const draining = setEnabled(true);
		await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
		await setEnabled(false);
		releaseList();
		await draining;

		expect(reply).not.toHaveBeenCalled();
		expect(list).toHaveBeenCalledOnce();
	});

	describe("calls the gateway refuses for sign-in, in manual mode", () => {
		const gatedTool = "desktop_environments_conda_envs_create";

		it("answers the permission itself and never shows it, so the sign-in prompt comes first", async () => {
			const isRefusedForSignIn = vi.fn(async () => true);
			const { approver, reply, onReveal, revealedIds, checkingIds } = setup({
				enabled: false,
				isRefusedForSignIn,
			});

			const held = approver.handleEvent(
				asked({ id: "perm-1", sessionID: "ses-1", permission: gatedTool }),
			);

			expect(held).toBe(true);
			expect(checkingIds()).toEqual(["perm-1"]);
			await vi.waitFor(() =>
				expect(reply).toHaveBeenCalledExactlyOnceWith("/workspace", {
					requestID: "perm-1",
					reply: "once",
				}),
			);
			expect(isRefusedForSignIn).toHaveBeenCalledWith(gatedTool);
			approver.handleEvent(replied("perm-1"));
			expect(checkingIds()).toEqual([]);
			expect(revealedIds()).toEqual([]);
			expect(onReveal).not.toHaveBeenCalled();
		});

		it("shows the permission at once when the call would run (signed in, or not a sign-in tool)", async () => {
			const { approver, reply, onReveal, checkingIds } = setup({
				enabled: false,
				isRefusedForSignIn: async () => false,
			});
			const event = asked({ id: "perm-1", sessionID: "ses-1", permission: gatedTool });

			approver.handleEvent(event);

			await vi.waitFor(() => expect(onReveal).toHaveBeenCalledExactlyOnceWith(event));
			expect(checkingIds()).toEqual([]);
			expect(reply).not.toHaveBeenCalled();
		});

		it("shows the permission when the check fails or the reply fails", async () => {
			const failingCheck = setup({
				enabled: false,
				isRefusedForSignIn: async () => {
					throw new Error("auth unavailable");
				},
			});
			vi.spyOn(console, "error").mockImplementation(() => undefined);
			failingCheck.approver.handleEvent(
				asked({ id: "perm-1", sessionID: "ses-1", permission: gatedTool }),
			);
			await vi.waitFor(() => expect(failingCheck.onReveal).toHaveBeenCalledOnce());
			expect(failingCheck.reply).not.toHaveBeenCalled();
			expect(failingCheck.checkingIds()).toEqual([]);

			const failingReply = setup({ enabled: false, isRefusedForSignIn: async () => true });
			failingReply.reply.mockRejectedValueOnce(new Error("offline"));
			failingReply.approver.handleEvent(
				asked({ id: "perm-2", sessionID: "ses-1", permission: gatedTool }),
			);
			await vi.waitFor(() => expect(failingReply.onReveal).toHaveBeenCalledOnce());
			expect(failingReply.checkingIds()).toEqual([]);
		});

		it("shows the permission if the check takes too long", async () => {
			vi.useFakeTimers();
			const { approver, onReveal, checkingIds } = setup({
				enabled: false,
				isRefusedForSignIn: () => new Promise<boolean>(() => undefined),
			});

			approver.handleEvent(asked({ id: "perm-1", sessionID: "ses-1", permission: gatedTool }));
			vi.advanceTimersByTime(1_000);

			expect(onReveal).toHaveBeenCalledOnce();
			expect(checkingIds()).toEqual([]);
		});

		it("leaves prompts that need a person alone", () => {
			const isRefusedForSignIn = vi.fn(async () => true);
			const { approver, reply } = setup({ enabled: false, isRefusedForSignIn });

			expect(
				approver.handleEvent(
					asked({
						id: "sandbox",
						sessionID: "ses-1",
						permission: gatedTool,
						metadata: { sandboxEscalation: true },
					}),
				),
			).toBe(false);
			expect(isRefusedForSignIn).not.toHaveBeenCalled();
			expect(reply).not.toHaveBeenCalled();
		});
	});
});
