import { useEffect, useState } from "react";

import { useSdk } from "@/platform/sdk";

/**
 * SDK Consumer — A second feature that ONLY consumes data from sdk-producer.
 *
 * Tests real inter-plugin communication:
 * - sdk.events.on("sdk-producer.*") — cross-feature event subscription
 * - sdk.state.get("sdk-producer.*") — cross-feature reactive state
 * - sdk.plugins.get("sdk-producer") — cross-feature capability access
 */
export function SdkConsumerView() {
	const sdk = useSdk("sdk-consumer");

	// ─── Cross-feature state: read sdk-producer's click-count ────────────
	const [clickCount, setClickCount] = useState<number | null>(null);

	useEffect(() => {
		const store = sdk.state.get<number>("sdk-producer.click-count");
		const unsub = store.subscribe((value) => {
			setClickCount(value);
		});
		return unsub;
	}, [sdk]);

	// ─── Cross-feature events: listen to sdk-producer's note-added ───────
	const [receivedEvents, setReceivedEvents] = useState<
		Array<{ id: string; text: string; at: string }>
	>([]);

	useEffect(() => {
		const unsub = sdk.events.on("sdk-producer.note-added", (payload) => {
			const data = payload as { id: string; text: string };
			setReceivedEvents((prev) =>
				[{ ...data, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 20),
			);
		});
		return unsub;
	}, [sdk]);

	// ─── Cross-feature capability: call sdk-producer's exposed service ───
	const [capabilityResult, setCapabilityResult] = useState<string | null>(null);

	function handleGetCapability() {
		const cap = sdk.plugins.get<{
			explorerService: { getInfo: () => { name: string; version: string } };
		}>("sdk-producer");
		if (cap) {
			const info = cap.explorerService.getInfo();
			setCapabilityResult(JSON.stringify(info));
		} else {
			setCapabilityResult("null — sdk-producer has not exposed capabilities yet");
		}
	}

	// ─── Cross-feature state: peek (one-shot read) ──────────────────────
	const [peekedValue, setPeekedValue] = useState<string>("(not yet peeked)");

	function handlePeek() {
		const value = sdk.state.peek("sdk-producer.click-count");
		const exists = sdk.state.has("sdk-producer.click-count");
		setPeekedValue(`${JSON.stringify(value)} (has: ${exists})`);
	}

	return (
		<main className="mx-auto max-w-3xl px-5 py-8">
			<header className="mb-6">
				<h1 className="text-2xl font-semibold tracking-tight">SDK Consumer</h1>
				<p className="text-muted-foreground mt-1 text-sm">
					A separate feature that reads data from <code>sdk-producer</code> via cross-feature SDK
					primitives. Open <code>/#/sdk-producer</code> in the SDK Producer tab and interact with it
					— changes appear here in real time.
				</p>
			</header>

			{/* ─── Cross-feature reactive state ───────────────────────────── */}
			<section className="mb-6">
				<h2 className="mb-2 text-lg font-medium">
					sdk.state.get(&quot;sdk-producer.click-count&quot;)
				</h2>
				<div className="bg-muted rounded p-4 text-center">
					<span className="text-3xl font-bold">
						{clickCount === null ? "null (not registered yet)" : clickCount}
					</span>
					<p className="text-muted-foreground mt-1 text-xs">
						Live subscription — updates when you click &quot;state.set&quot; in sdk-producer
					</p>
				</div>
				<button
					type="button"
					className="bg-secondary text-secondary-foreground hover:bg-secondary/80 mt-2 rounded-md px-3 py-1.5 text-xs font-medium"
					onClick={handlePeek}
				>
					state.peek (one-shot)
				</button>
				<span className="text-muted-foreground ml-2 text-xs">→ {peekedValue}</span>
			</section>

			{/* ─── Cross-feature events ───────────────────────────────────── */}
			<section className="mb-6">
				<h2 className="mb-2 text-lg font-medium">
					sdk.events.on(&quot;sdk-producer.note-added&quot;)
				</h2>
				{receivedEvents.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No events yet. Add a note in sdk-producer to see cross-feature events here.
					</p>
				) : (
					<ul className="grid gap-1">
						{receivedEvents.map((evt, i) => (
							<li key={i} className="bg-muted rounded px-3 py-2 font-mono text-xs">
								<span className="text-muted-foreground">[{evt.at}]</span> note-added: id=
								{evt.id.slice(0, 8)}… text=&quot;{evt.text}&quot;
							</li>
						))}
					</ul>
				)}
			</section>

			{/* ─── Cross-feature capability ───────────────────────────────── */}
			<section className="mb-6">
				<h2 className="mb-2 text-lg font-medium">sdk.plugins.get(&quot;sdk-producer&quot;)</h2>
				<button
					type="button"
					className="bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md px-3 py-1.5 text-xs font-medium"
					onClick={handleGetCapability}
				>
					Call explorerService.getInfo()
				</button>
				{capabilityResult && (
					<pre className="bg-muted mt-2 rounded p-3 font-mono text-xs">{capabilityResult}</pre>
				)}
			</section>
		</main>
	);
}
