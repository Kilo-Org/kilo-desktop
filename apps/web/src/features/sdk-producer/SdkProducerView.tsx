import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SdkProducerService } from "@anaconda-agentic-desktop/contracts";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import {
	addNoteMutationOptions,
	clearNotesMutationOptions,
	deleteNoteMutationOptions,
	echoMutationOptions,
	listNotesQueryOptions,
} from "./useNotes";

/**
 * SDK Producer — Interactive demo exercising every SDK shim API.
 *
 * SDK APIs tested:
 * - sdk.featureId (identity)
 * - sdk.client / sdk.invoke (CRUD operations via handlers)
 * - sdk.events.emit / sdk.events.on (pub/sub)
 * - sdk.state.register / sdk.state.get / sdk.state.peek (reactive state)
 * - sdk.plugins.expose / sdk.plugins.get (capabilities)
 * - sdk.contribute (UI zone contributions — rendered by the shell's ZoneOutlet)
 * - sdk.commands.register (command palette)
 * - sdk.notifications.show / sdk.notifications.setBadge (shell notifications)
 * - sdk.theme.subscribe / sdk.theme.peek (theme observation)
 * - sdk.shell.openExternal / sdk.shell.copyText (shell operations)
 * - sdk.navigate / sdk.location (shell navigation delegate)
 * - sdk.fs.* (scoped filesystem sandbox — Electron only; rejects in browser mode)
 * - sdk.tools / sdk.intents / sdk.dispatch (deferred — expected to throw)
 * - sdk.onDispose (cleanup registration)
 */
export function SdkProducerView() {
	const sdk = useSdk<SdkProducerService>("sdk-producer");
	const qc = useQueryClient();

	// ─── sdk.client via TanStack Query ──────────────────────────────────────
	const notes = useQuery(listNotesQueryOptions(sdk));
	const addNote = useMutation(addNoteMutationOptions(sdk, qc));
	const deleteNote = useMutation(deleteNoteMutationOptions(sdk, qc));
	const clearNotes = useMutation(clearNotesMutationOptions(sdk, qc));
	const echo = useMutation(echoMutationOptions(sdk));

	const [noteText, setNoteText] = useState("");
	const [log, setLog] = useState<string[]>([]);

	function appendLog(entry: string) {
		setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${entry}`, ...prev].slice(0, 50));
	}

	// ─── sdk.events — subscribe to our own events ───────────────────────────
	useEffect(() => {
		const unsub = sdk.events.on("sdk-producer.note-added", (payload) => {
			appendLog(`Event received: note-added → ${JSON.stringify(payload)}`);
		});
		return unsub;
	}, [sdk]);

	// ─── sdk.state — register a reactive store ──────────────────────────────
	const [clickCount, setClickCount] = useState(0);
	const [stateHandle] = useState(() => sdk.state.register("click-count", 0));

	useEffect(() => {
		const store = sdk.state.get<number>("sdk-producer.click-count");
		const unsub = store.subscribe((value) => {
			setClickCount(value ?? 0);
		});
		return unsub;
	}, [sdk]);

	// ─── sdk.plugins.expose — expose a capability on mount ──────────────────
	useEffect(() => {
		sdk.plugins.expose("explorerService", {
			getInfo: () => ({ name: "sdk-producer", version: "2.0.0" }),
		});
		appendLog("Capability exposed: explorerService");
	}, [sdk]);

	// ─── sdk.contribute — register a UI contribution ────────────────────────
	useEffect(() => {
		const remove = sdk.contribute("status-bar", {
			component: SdkProducerStatusBarItem,
			label: "SDK Explorer",
			priority: 10,
		});
		appendLog("Contribution registered: status-bar zone");
		return remove;
	}, [sdk]);

	// ─── sdk.commands.register — add command palette entries ─────────────────
	useEffect(() => {
		sdk.commands.register({
			id: "clear-notes",
			label: "SDK Explorer: Clear All Notes",
			handler: () => {
				clearNotes.mutate(undefined);
				appendLog("Command executed: clear-notes");
			},
		});
		sdk.commands.register({
			id: "log-state",
			label: "SDK Explorer: Log State",
			handler: () => {
				const peeked = sdk.state.peek("sdk-producer.click-count");
				appendLog(`Command executed: log-state → click-count = ${peeked}`);
			},
		});
		appendLog("Commands registered: clear-notes, log-state");
	}, [sdk]);

	// ─── sdk.theme — subscribe to theme changes ─────────────────────────────
	const [theme, setTheme] = useState<"dark" | "light">(sdk.theme.peek());

	useEffect(() => {
		const unsub = sdk.theme.subscribe((t) => {
			setTheme(t);
			appendLog(`Theme changed: ${t}`);
		});
		return unsub;
	}, [sdk]);

	// ─── sdk.onDispose — register cleanup ───────────────────────────────────
	useEffect(() => {
		sdk.onDispose(() => {
			console.info("[sdk-producer] Dispose callback fired from renderer");
		});
	}, [sdk]);

	// ─── Action handlers ────────────────────────────────────────────────────

	function handleAddNote(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const text = noteText.trim();
		if (!text) return;
		addNote.mutate(text, {
			onSuccess: (note) => {
				setNoteText("");
				appendLog(`client.add() → created note: ${note.id}`);
				// Also emit an event to test sdk.events.emit
				sdk.events.emit("note-added", { id: note.id, text: note.text });
			},
		});
	}

	function handleStateClick() {
		const next = clickCount + 1;
		stateHandle.set(next);
		appendLog(`state.set("click-count", ${next})`);
	}

	function handleEcho() {
		echo.mutate("hello from sdk-producer", {
			onSuccess: (result) => {
				appendLog(`client.echo() → ${result.echoed}`);
			},
		});
	}

	function handlePluginsGet() {
		const cap = sdk.plugins.get<{
			explorerService: { getInfo: () => { name: string; version: string } };
		}>("sdk-producer");
		if (cap) {
			const info = cap.explorerService.getInfo();
			appendLog(`plugins.get<T>("sdk-producer") → ${JSON.stringify(info)}`);
		} else {
			appendLog("plugins.get returned null (no capability found)");
		}
	}

	function handleNotification() {
		void sdk.notifications
			.show({
				title: "SDK Explorer",
				message: "This is a test notification from the SDK explorer feature.",
				type: "success",
			})
			.then((result) => {
				appendLog(
					`notifications.show() → delivered: ${result.delivered}${result.reason ? `, reason: ${result.reason}` : ""}`,
				);
			});
	}

	function handleBadge() {
		void sdk.notifications.setBadge(notes.data?.length ?? 0).then((result) => {
			appendLog(
				`notifications.setBadge() → delivered: ${result.delivered}${result.reason ? `, reason: ${result.reason}` : ""}`,
			);
		});
	}

	function handleCopyText() {
		void sdk.shell.copyText("Copied from SDK Explorer!").then(() => {
			appendLog("shell.copyText() succeeded");
		});
	}

	function handleOpenExternal() {
		void sdk.shell.openExternal("https://github.com/anaconda/agentic-desktop").then((result) => {
			appendLog(`shell.openExternal() → opened: ${result.opened}`);
		});
	}

	function handleFsTest() {
		// Round-trip through the feature's scoped fs sandbox
		// (`${userData}/plugins/sdk-producer/`). Browser mode has no
		// filesystem, so the failure branch is expected there.
		void (async () => {
			try {
				await sdk.fs.writeFile("demo/hello.txt", "Hello from sdk.fs!");
				const content = await sdk.fs.readFile("demo/hello.txt");
				const entries = await sdk.fs.readdir("demo");
				appendLog(`fs round-trip → read "${content}", readdir: [${entries.join(", ")}]`);
			} catch (error) {
				appendLog(`fs round-trip FAILED: ${(error as Error).message}`);
			}
		})();
	}

	function handleNavigation() {
		const location = sdk.location.peek();
		appendLog(`location.peek() → ${location.path}`);
		// Navigate to this feature's own route — proves the delegate is wired
		// without yanking the user off the page.
		sdk.navigate("/sdk-producer");
		appendLog(`navigate("/sdk-producer") dispatched`);
	}

	function handleDeferredTest() {
		const results: string[] = [];
		try {
			sdk.tools.register({});
		} catch {
			results.push(`tools.register: threw`);
		}
		try {
			sdk.intents.list();
		} catch {
			results.push(`intents.list: threw`);
		}
		try {
			sdk.dispatch({ plugin: "x", action: "y" });
		} catch {
			results.push(`dispatch: threw`);
		}
		appendLog(`Deferred APIs (all expected to throw): ${results.length}/3 threw correctly`);
	}

	// ─── Render ─────────────────────────────────────────────────────────────

	return (
		<main className="mx-auto max-w-3xl px-5 py-8">
			<header className="mb-6">
				<h1 className="text-2xl font-semibold tracking-tight">SDK Producer</h1>
				<p className="text-muted-foreground mt-1 text-sm">
					Interactive demo exercising every SDK shim API. Feature ID:{" "}
					<code className="bg-muted rounded px-1">{sdk.featureId}</code> | Theme:{" "}
					<code className="bg-muted rounded px-1">{theme}</code>
				</p>
			</header>

			{/* ─── sdk.client: Notes CRUD ─────────────────────────────────── */}
			<section className="mb-6">
				<h2 className="mb-2 text-lg font-medium">sdk.client — Notes CRUD</h2>
				<form className="mb-3 flex gap-2" onSubmit={handleAddNote}>
					<input
						className="border-input bg-background ring-offset-background placeholder:text-muted-foreground flex-1 rounded-md border px-3 py-2 text-sm"
						placeholder="Write a note..."
						maxLength={500}
						value={noteText}
						data-qa-id="note-input"
						onChange={(e) => setNoteText(e.target.value)}
					/>
					<button
						type="submit"
						data-qa-id="note-add"
						className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
						disabled={!noteText.trim() || addNote.isPending}
					>
						Add
					</button>
					<button
						type="button"
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-4 py-2 text-sm font-medium"
						onClick={() => clearNotes.mutate(undefined)}
					>
						Clear All
					</button>
				</form>
				{notes.data?.length === 0 ? (
					<p className="text-muted-foreground text-sm">No notes yet.</p>
				) : (
					<ul className="grid gap-1">
						{notes.data?.map((note) => (
							<li
								key={note.id}
								data-qa-id="note-item"
								className="bg-muted flex items-center justify-between rounded px-3 py-2 text-sm"
							>
								<span>{note.text}</span>
								<button
									className="text-destructive hover:text-destructive/80 text-xs"
									onClick={() => deleteNote.mutate(note.id)}
								>
									delete
								</button>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* ─── SDK API Buttons ────────────────────────────────────────── */}
			<section className="mb-6">
				<h2 className="mb-2 text-lg font-medium">SDK API Actions</h2>
				<div className="flex flex-wrap gap-2">
					<ActionButton label={`state.set (count: ${clickCount})`} onClick={handleStateClick} />
					<ActionButton label="client.echo" onClick={handleEcho} />
					<ActionButton label="plugins.get" onClick={handlePluginsGet} />
					<ActionButton label="notifications.show" onClick={handleNotification} />
					<ActionButton label="notifications.setBadge" onClick={handleBadge} />
					<ActionButton label="shell.copyText" onClick={handleCopyText} />
					<ActionButton label="shell.openExternal" onClick={handleOpenExternal} />
					<ActionButton label="navigate + location" onClick={handleNavigation} />
					<ActionButton label="fs round-trip" onClick={handleFsTest} />
					<ActionButton label="deferred APIs (expect throws)" onClick={handleDeferredTest} />
				</div>
			</section>

			{/* ─── Activity Log ───────────────────────────────────────────── */}
			<section>
				<h2 className="mb-2 text-lg font-medium">Activity Log</h2>
				<div className="bg-muted max-h-64 overflow-y-auto rounded p-3 font-mono text-xs">
					{log.length === 0 ? (
						<p className="text-muted-foreground">No activity yet. Try the buttons above.</p>
					) : (
						log.map((entry, i) => (
							<div key={i} className="border-border border-b py-1 last:border-0">
								{entry}
							</div>
						))
					)}
				</div>
			</section>
		</main>
	);
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			className="bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md px-3 py-1.5 text-xs font-medium"
			onClick={onClick}
		>
			{label}
		</button>
	);
}

/** Status-bar zone contribution — rendered by the shell's ZoneOutlet while this view is mounted. */
function SdkProducerStatusBarItem() {
	return <span data-qa-id="sdk-producer-status-bar-item">SDK Explorer active</span>;
}
