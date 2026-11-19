/**
 * Reading blocks: the passages Focus moves between and dims. A block is a
 * paragraph, heading, list item, table, blockquote or code block (its header
 * row and body together) inside rendered Markdown (`.aui-md`). Lists are not
 * blocks themselves; each item is, with any nested list inside it.
 */
export interface ReadingBlock {
	/** The block's elements, in order (a code block's header and body). */
	readonly elements: readonly HTMLElement[];
}

const MARKDOWN_ROOT = ".aui-md";
const LIST_TAGS = new Set(["UL", "OL"]);
const SKIPPED_TAGS = new Set(["HR", "BR", "SCRIPT", "STYLE", "TEMPLATE"]);
const CODE_HEADER = "aui-code-header-root";

function isVisibleBlock(element: HTMLElement): boolean {
	if (SKIPPED_TAGS.has(element.tagName)) return false;
	if (element.hidden) return false;
	return element.textContent?.trim() !== "" || element.querySelector("img, svg, table") !== null;
}

function blocksOf(container: Element): ReadingBlock[] {
	const blocks: ReadingBlock[] = [];
	let pendingHeader: HTMLElement | null = null;
	for (const child of container.children) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.classList.contains(CODE_HEADER)) {
			pendingHeader = child;
			continue;
		}
		if (LIST_TAGS.has(child.tagName)) {
			for (const item of child.children) {
				if (item instanceof HTMLElement && item.tagName === "LI" && isVisibleBlock(item)) {
					blocks.push({ elements: [item] });
				}
			}
		} else if (isVisibleBlock(child)) {
			blocks.push({ elements: pendingHeader ? [pendingHeader, child] : [child] });
		}
		pendingHeader = null;
	}
	return blocks;
}

/** Every reading block under `root`, in document order (`root` may itself be `.aui-md`). */
export function readingBlocks(root: Element): ReadingBlock[] {
	const markdown = root.matches(MARKDOWN_ROOT)
		? [root]
		: [...root.querySelectorAll(MARKDOWN_ROOT)].filter(
				(element) => element.parentElement?.closest(MARKDOWN_ROOT) === null,
			);
	return markdown.flatMap(blocksOf);
}

/** The index of the block containing `node`, or -1. */
export function blockIndexOf(blocks: readonly ReadingBlock[], node: Node | null): number {
	if (!node) return -1;
	return blocks.findIndex((block) => block.elements.some((element) => element.contains(node)));
}

export interface BlockBox {
	readonly top: number;
	readonly bottom: number;
}

export function blockBox(block: ReadingBlock): BlockBox {
	const boxes = block.elements.map((element) => element.getBoundingClientRect());
	return {
		top: Math.min(...boxes.map((box) => box.top)),
		bottom: Math.max(...boxes.map((box) => box.bottom)),
	};
}

/**
 * The block at viewport height `y`: the one spanning it, else the nearest
 * (gaps between blocks belong to the closer one). -1 when there are none.
 */
export function blockIndexAt(blocks: readonly ReadingBlock[], y: number): number {
	let nearest = -1;
	let nearestDistance = Number.POSITIVE_INFINITY;
	blocks.forEach((block, index) => {
		const { top, bottom } = blockBox(block);
		const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
		if (distance < nearestDistance) {
			nearest = index;
			nearestDistance = distance;
		}
	});
	return nearest;
}
