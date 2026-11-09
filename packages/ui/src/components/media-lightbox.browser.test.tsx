import { cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	MediaLightbox,
	MediaViewer,
	lightboxItemTitle,
	type LightboxItem,
} from "./media-lightbox.js";

function pngDataUrl(width: number, height: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (context) {
		context.fillStyle = "teal";
		context.fillRect(0, 0, width, height);
	}
	return canvas.toDataURL("image/png");
}

const photo: LightboxItem = {
	kind: "image",
	id: "photo",
	src: pngDataUrl(400, 200),
	alt: "Teal photo",
};
const diagram: LightboxItem = {
	kind: "mermaid",
	id: "diagram",
	code: "flowchart LR\n  Start --> Done",
	label: "Flowchart",
};

function Harness({
	items,
	onOpenChange,
}: {
	readonly items: readonly LightboxItem[];
	readonly onOpenChange?: (open: boolean) => void;
}) {
	const [open, setOpen] = useState(true);
	const [index, setIndex] = useState(0);
	return (
		<MediaLightbox
			items={items}
			index={index}
			onIndexChange={setIndex}
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				onOpenChange?.(next);
			}}
			renderActions={(item) => (
				<button type="button" data-qa-id="test-action">
					Action for {item.id}
				</button>
			)}
		/>
	);
}

const zoomLevel = () => page.getByTestId("media-lightbox-zoom-level");
const percent = () =>
	Number(
		document
			.querySelector('[data-qa-id="media-lightbox-zoom-level"]')
			?.textContent?.replace("%", ""),
	);
/** The readout rounds, so a stepped zoom is within a point of fit × step. */
const isStepAbove = (fit: number) => () => Math.abs(percent() - fit * 1.25) <= 1;
const contentTransform = () =>
	document.querySelector<HTMLElement>('[data-qa-id="media-lightbox-content"]')?.style.transform ??
	"";
const stage = () => {
	const element = document.querySelector<HTMLElement>('[data-qa-id="media-lightbox-stage"]');
	if (!element) throw new Error("no stage");
	return element;
};

async function openedAtFit() {
	await expect.element(page.getByTestId("media-lightbox-fit")).toBeDisabled();
	// The content is placed once measured; a diagram first waits for Pele to load lazily.
	await expect.poll(contentTransform, { timeout: 15_000 }).toContain("scale(");
	return percent();
}

let downloads: { download: string; href: string }[] = [];

beforeEach(() => {
	downloads = [];
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		downloads.push({ download: this.download, href: this.href });
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("MediaLightbox", () => {
	it("zooms with the toolbar and returns to fit", async () => {
		render(<Harness items={[photo]} />);
		await expect.element(page.getByRole("dialog", { name: "Teal photo" })).toBeVisible();
		const fit = await openedAtFit();

		await page.getByTestId("media-lightbox-zoom-in").click();
		await expect.poll(isStepAbove(fit)).toBe(true);
		await page.getByTestId("media-lightbox-zoom-out").click();
		await page.getByTestId("media-lightbox-zoom-out").click();
		await expect.poll(percent).toBeLessThan(fit);

		await page.getByTestId("media-lightbox-actual").click();
		await expect.element(zoomLevel()).toHaveTextContent("100%");

		await page.getByTestId("media-lightbox-fit").click();
		await expect.poll(percent).toBe(fit);
		await expect.element(page.getByTestId("media-lightbox-fit")).toBeDisabled();
	});

	it("zooms with the wheel and keys, and double-click toggles fit", async () => {
		render(<Harness items={[photo]} />);
		const fit = await openedAtFit();
		const rect = stage().getBoundingClientRect();

		stage().dispatchEvent(
			new WheelEvent("wheel", {
				deltaY: -100,
				clientX: rect.left + 20,
				clientY: rect.top + 20,
				bubbles: true,
				cancelable: true,
			}),
		);
		await expect.poll(percent).toBeGreaterThan(fit);

		await userEvent.keyboard("0");
		await expect.poll(percent).toBe(fit);
		await userEvent.keyboard("+");
		await expect.poll(isStepAbove(fit)).toBe(true);
		await userEvent.keyboard("-");
		await expect.poll(percent).toBe(fit);

		await page.getByTestId("media-lightbox-stage").dblClick();
		await expect.poll(percent).toBeGreaterThan(fit);
		await page.getByTestId("media-lightbox-stage").dblClick();
		await expect.poll(percent).toBe(fit);
	});

	it("pans zoomed content by dragging", async () => {
		render(<Harness items={[photo]} />);
		await openedAtFit();
		await page.getByTestId("media-lightbox-actual").click();
		await userEvent.keyboard("+");
		await userEvent.keyboard("+");
		const before = contentTransform();

		const pointer = (type: string, x: number) =>
			stage().dispatchEvent(
				new PointerEvent(type, {
					pointerId: 7,
					pointerType: "mouse",
					button: 0,
					clientX: x,
					clientY: 100,
					bubbles: true,
				}),
			);
		pointer("pointerdown", 200);
		pointer("pointermove", 150);
		pointer("pointerup", 150);

		await expect.poll(contentTransform).not.toBe(before);
	});

	it("moves between items with arrows and buttons and closes on Escape", async () => {
		const onOpenChange = vi.fn();
		const second: LightboxItem = { ...photo, id: "second", alt: "Second photo" };
		render(<Harness items={[photo, second]} onOpenChange={onOpenChange} />);
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("1 / 2");
		await openedAtFit();

		await userEvent.keyboard("{ArrowRight}");
		await expect.element(page.getByRole("dialog", { name: "Second photo" })).toBeVisible();
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("2 / 2");
		await userEvent.keyboard("{ArrowRight}");
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("1 / 2");
		await page.getByTestId("media-lightbox-prev").click();
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("2 / 2");
		await page.getByTestId("media-lightbox-next").click();
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("1 / 2");

		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("media-lightbox")).not.toBeInTheDocument();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("shows a single item without gallery controls", async () => {
		render(<Harness items={[photo]} />);
		await openedAtFit();
		expect(document.querySelector('[data-qa-id="media-lightbox-counter"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="media-lightbox-prev"]')).toBeNull();
		await userEvent.keyboard("{ArrowRight}");
		await expect.element(page.getByRole("dialog", { name: "Teal photo" })).toBeVisible();
		await expect.element(page.getByTestId("test-action")).toHaveTextContent("Action for photo");
	});

	it("downloads the original image", async () => {
		render(<Harness items={[photo, { ...photo, id: "named", filename: "shot.png" }]} />);
		await openedAtFit();

		await page.getByTestId("media-lightbox-download").click();
		await page.getByTestId("media-lightbox-next").click();
		await page.getByTestId("media-lightbox-download").click();

		await expect.poll(() => downloads.length).toBe(2);
		expect(downloads[0]?.download).toMatch(/^image-\d{8}-\d{6}\.png$/u);
		expect(downloads[0]?.href.startsWith("blob:")).toBe(true);
		expect(downloads[1]?.download).toBe("shot.png");
	});

	it("renders a diagram and exports it as SVG and PNG", async () => {
		render(<Harness items={[diagram]} />);
		await expect.element(page.getByRole("dialog", { name: "Flowchart" })).toBeVisible();
		await openedAtFit();
		const svg = document.querySelector('[data-qa-id="media-lightbox-content"] svg');
		expect(svg).not.toBeNull();
		expect(document.querySelector('[data-qa-id="media-lightbox"] .pele-zoom')).toBeNull();

		await page.getByTestId("media-lightbox-download").click();
		await page.getByTestId("media-lightbox-download-svg").click();
		await expect.element(page.getByTestId("media-lightbox-download-svg")).not.toBeInTheDocument();
		await page.getByTestId("media-lightbox-download").click();
		await page.getByTestId("media-lightbox-download-png").click();

		await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(2);
		expect(downloads[0]?.download).toMatch(/^flowchart-\d{8}-\d{6}\.svg$/u);
		expect(downloads[1]?.download).toMatch(/^flowchart-\d{8}-\d{6}\.png$/u);
	});
});

describe("MediaViewer", () => {
	it("fills its container without a dialog and keeps the controls", async () => {
		const onIndexChange = vi.fn();
		const outer = vi.fn();
		render(
			<div style={{ height: 500 }} onPointerDown={outer}>
				<MediaViewer
					className="h-full"
					items={[photo, { ...photo, id: "other", alt: "Other photo" }]}
					index={0}
					onIndexChange={onIndexChange}
				/>
			</div>,
		);

		await expect.element(page.getByRole("heading", { name: "Teal photo" })).toBeVisible();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="media-lightbox-close"]')).toBeNull();
		await openedAtFit();

		await page.getByTestId("media-lightbox-zoom-in").click();
		await expect.element(page.getByTestId("media-lightbox-fit")).toBeEnabled();
		await userEvent.keyboard("{ArrowRight}");
		expect(onIndexChange).toHaveBeenCalledWith(1);

		outer.mockClear();
		stage().dispatchEvent(
			new PointerEvent("pointerdown", { pointerId: 3, pointerType: "mouse", bubbles: true }),
		);
		expect(outer).not.toHaveBeenCalled();
	});

	it("renders nothing for an index out of range", () => {
		render(<MediaViewer items={[photo]} index={4} onIndexChange={() => {}} />);
		expect(document.querySelector('[data-qa-id="media-viewer"]')?.childElementCount).toBe(0);
	});

	it("keeps a hidden title for screen readers only", async () => {
		render(<MediaViewer items={[photo]} index={0} onIndexChange={() => {}} hideTitle />);

		const heading = page.getByRole("heading", { name: "Teal photo" });
		await expect.element(heading).toBeInTheDocument();
		expect(heading.element().className).toContain("sr-only");
	});

	it("shows custom content without zoom or download, and moves on with the arrows", async () => {
		const onIndexChange = vi.fn();
		render(
			<div style={{ height: 400 }}>
				<MediaViewer
					className="h-full"
					items={[
						{ kind: "custom", id: "page", title: "Sales chart", content: <p>Live chart</p> },
						photo,
					]}
					index={0}
					onIndexChange={onIndexChange}
				/>
			</div>,
		);

		await expect.element(page.getByRole("heading", { name: "Sales chart" })).toBeVisible();
		await expect.element(page.getByText("Live chart")).toBeVisible();
		expect(document.querySelector('[data-qa-id="media-lightbox-zoom-in"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="media-lightbox-download"]')).toBeNull();
		await userEvent.keyboard("{ArrowRight}");
		expect(onIndexChange).toHaveBeenCalledWith(1);
	});

	it("shows a diagram's own error and source, unscaled, when it can't render", async () => {
		render(
			<div style={{ height: 400 }}>
				<MediaViewer
					className="h-full"
					items={[{ kind: "mermaid", id: "bad", code: "notADiagram\n  nonsense", label: "Bad" }]}
					index={0}
					onIndexChange={() => {}}
				/>
			</div>,
		);

		await expect
			.element(page.getByRole("alert").getByText("Could not render this Mermaid diagram"), {
				timeout: 15_000,
			})
			.toBeVisible();
		await expect.element(page.getByText("nonsense", { exact: false })).toBeVisible();
		expect(document.querySelector('[data-qa-id="media-lightbox-zoom-in"]')).toBeNull();
		expect(contentTransform()).toBe("");
	});
});

describe("lightboxItemTitle", () => {
	it("prefers the label, alt text, then filename", () => {
		expect(lightboxItemTitle(diagram)).toBe("Flowchart");
		expect(lightboxItemTitle({ kind: "custom", id: "c", title: "Page", content: null })).toBe(
			"Page",
		);
		expect(
			lightboxItemTitle({ kind: "image", id: "a", src: "x", alt: " ", filename: "a.png" }),
		).toBe("a.png");
		expect(lightboxItemTitle({ kind: "image", id: "a", src: "x" })).toBe("Image");
	});
});
