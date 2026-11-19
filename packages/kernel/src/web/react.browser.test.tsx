import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import { defineDomainObject } from "../domain-object";
import { defineObjectType, ref, type ObjectRef } from "../object-type";
import { defineExtensionPoint } from "../extension-point";
import type { PluginSdk } from "../sdk";
import { createTestKernelPair, testPlugin } from "../testing";
import { dragSourceProps, useDropTarget } from "./dnd";
import {
	KernelProvider,
	useContextKey,
	useDomainObjectState,
	useExtensions,
	useSdk,
} from "./react";

const Counter = defineDomainObject({
	id: "acme.host/counter",
	home: "main",
	state: z.object({ count: z.number() }),
});

const Badge = defineExtensionPoint({
	id: "acme.host/badge",
	kind: "additive",
	metadata: z.object({ label: z.string() }),
});

const Session = defineObjectType({ id: "acme.host/session" });

const hostManifest = {
	domainObjects: [{ id: "counter", home: "main" }],
	objectTypes: [{ id: "session" }],
	extensionPoints: [{ id: "badge", kind: "additive" }],
	contextKeys: [{ id: "busy", scope: "window" }],
};
const definitions = { domainObjects: [Counter], objectTypes: [Session], extensionPoints: [Badge] };

const selectCount = (state: { count: number }) => state.count;

function Probe() {
	const count = useDomainObjectState(Counter, selectCount);
	const badges = useExtensions(Badge);
	const busy = useContextKey("acme.host/busy");
	return (
		<div>
			<span data-qa-id="count">{count ?? "unavailable"}</span>
			<span data-qa-id="badges">{badges.map((badge) => badge.metadata.label).join(",")}</span>
			<span data-qa-id="busy">{busy ? "busy" : "idle"}</span>
		</div>
	);
}

async function bootProbe(ui = <Probe />) {
	let provider: { setState(state: { count: number }): void } | undefined;
	const { main, renderer } = await createTestKernelPair({
		main: [
			testPlugin("acme.host", {
				manifest: hostManifest,
				definitions,
				entry: {
					activate: (sdk: PluginSdk) => {
						provider = sdk.domainObjects.provide(Counter, {
							initialState: { count: 1 },
							methods: {},
						});
					},
				},
			}),
		],
		renderer: [
			testPlugin("acme.host", {
				manifest: hostManifest,
				definitions,
				entry: { activate: () => {} },
			}),
		],
	});
	render(<KernelProvider kernel={renderer}>{ui}</KernelProvider>);
	return { main, renderer, provider: () => provider! };
}

afterEach(() => {
	cleanup();
});

describe("React bindings", () => {
	it("re-render when domain state, contributions and context keys change", async () => {
		const { main, renderer, provider } = await bootProbe();
		await expect.element(page.getByTestId("count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("busy")).toHaveTextContent("idle");

		provider().setState({ count: 5 });
		await main.flush();
		renderer.sdkFor("acme.host").extensions.add(Badge, { id: "new", label: "New" });
		renderer.sdkFor("acme.host").context.set("busy", true);

		await expect.element(page.getByTestId("count")).toHaveTextContent("5");
		await expect.element(page.getByTestId("badges")).toHaveTextContent("New");
		await expect.element(page.getByTestId("busy")).toHaveTextContent("busy");
	});

	it("show a domain as unavailable once its provider goes away", async () => {
		const { main, renderer } = await bootProbe();
		await expect.element(page.getByTestId("count")).toHaveTextContent("1");

		await main.deactivate();
		await renderer.flush();

		await expect.element(page.getByTestId("count")).toHaveTextContent("unavailable");
	});
});

describe("KernelProvider", () => {
	function WhoAmI() {
		return <span data-qa-id="who">{useSdk().pluginId}</span>;
	}

	it("renders as the window's kernel, or as a plugin's window half", async () => {
		const { renderer } = await bootProbe();
		cleanup();

		render(<KernelProvider kernel={renderer}>{<WhoAmI />}</KernelProvider>);
		await expect.element(page.getByTestId("who")).toHaveTextContent("kernel");
		cleanup();

		render(
			<KernelProvider kernel={renderer} as="acme.host">
				<WhoAmI />
			</KernelProvider>,
		);
		await expect.element(page.getByTestId("who")).toHaveTextContent("acme.host");
	});
});

describe("useDomainObjectState with an equality check", () => {
	const selectParity = (state: { count: number }) => ({ even: state.count % 2 === 0 });
	const sameParity = (a: { even: boolean }, b: { even: boolean }) => a.even === b.even;

	it("re-renders only when the selection changes by that check", async () => {
		let renders = 0;
		function Parity() {
			const parity = useDomainObjectState(Counter, selectParity, sameParity);
			renders += 1;
			return <span data-qa-id="parity">{parity?.even ? "even" : "odd"}</span>;
		}
		const { main, provider } = await bootProbe(<Parity />);
		await expect.element(page.getByTestId("parity")).toHaveTextContent("odd");
		const settled = renders;

		provider().setState({ count: 3 });
		await main.flush();
		expect(renders).toBe(settled);

		provider().setState({ count: 4 });
		await main.flush();
		await expect.element(page.getByTestId("parity")).toHaveTextContent("even");
	});
});

describe("drag and drop hooks", () => {
	function DragAndDrop({ onDrop }: { readonly onDrop: (refs: ObjectRef[]) => void }) {
		const source = dragSourceProps([ref(Session, "s1")]);
		const target = useDropTarget({ accepts: [Session], onDrop });
		return (
			<div>
				<div data-qa-id="source" {...source}>
					Session
				</div>
				<div data-qa-id="target" {...target.props}>
					{target.isOver ? "over" : "waiting"}
				</div>
			</div>
		);
	}

	/** Native events sharing one DataTransfer, as in a real drag. */
	function drag(element: Element, type: string, dataTransfer: DataTransfer) {
		act(() => {
			element.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }));
		});
	}

	it("delivers dragged references to a target that accepts their type", async () => {
		const onDrop = vi.fn();
		render(<DragAndDrop onDrop={onDrop} />);
		const dataTransfer = new DataTransfer();
		const source = page.getByTestId("source").element();
		const target = page.getByTestId("target").element();

		drag(source, "dragstart", dataTransfer);
		drag(target, "dragenter", dataTransfer);
		await expect.element(page.getByTestId("target")).toHaveTextContent("over");
		drag(target, "drop", dataTransfer);

		expect(onDrop.mock.calls[0]?.[0]).toEqual([{ type: "acme.host/session", id: "s1" }]);
		await expect.element(page.getByTestId("target")).toHaveTextContent("waiting");
	});

	it("follows an accepted drag over the target and reports when it leaves", async () => {
		const onOver = vi.fn();
		const onLeave = vi.fn();
		function Target() {
			const source = dragSourceProps([ref(Session, "s1")]);
			const target = useDropTarget({ accepts: [Session], onDrop: () => {}, onOver, onLeave });
			return (
				<div>
					<div data-qa-id="source" {...source}>
						Session
					</div>
					<div data-qa-id="target" {...target.props}>
						<span data-qa-id="child">child</span>
					</div>
				</div>
			);
		}
		render(<Target />);
		const dataTransfer = new DataTransfer();
		const target = page.getByTestId("target").element();

		drag(page.getByTestId("source").element(), "dragstart", dataTransfer);
		drag(target, "dragenter", dataTransfer);
		drag(target, "dragover", dataTransfer);
		expect(onOver).toHaveBeenCalledTimes(2);
		act(() => {
			target.dispatchEvent(
				new DragEvent("dragleave", {
					dataTransfer,
					bubbles: true,
					relatedTarget: page.getByTestId("child").element(),
				}),
			);
		});
		expect(onLeave).not.toHaveBeenCalled();
		drag(target, "dragleave", dataTransfer);
		expect(onLeave).toHaveBeenCalledOnce();
	});

	it("offers nothing from a disabled source", async () => {
		function Source() {
			return (
				<div data-qa-id="source" {...dragSourceProps([ref(Session, "s1")], { disabled: true })}>
					Session
				</div>
			);
		}
		render(<Source />);
		const dataTransfer = new DataTransfer();

		drag(page.getByTestId("source").element(), "dragstart", dataTransfer);

		expect(page.getByTestId("source").element().getAttribute("draggable")).toBe("false");
		expect(dataTransfer.types).toEqual([]);
	});

	it("ignores drops of types the target does not accept", async () => {
		const onDrop = vi.fn();
		render(<DragAndDrop onDrop={onDrop} />);
		const dataTransfer = new DataTransfer();
		dataTransfer.setData("text/plain", "not a reference");

		drag(page.getByTestId("target").element(), "drop", dataTransfer);

		expect(onDrop).not.toHaveBeenCalled();
	});
});
