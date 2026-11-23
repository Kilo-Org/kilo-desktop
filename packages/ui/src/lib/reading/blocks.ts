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
 * (a gap between blocks belongs to the closer one, the earlier on a tie). -1
 * when there are none. Blocks are in reading order, stacked down the page, so
 * this binary-searches: O(log n) layout reads, not one per block, as it runs
 * on every scroll frame.
 */
export function blockIndexAt(blocks: readonly ReadingBlock[], y: number): number {
	if (blocks.length === 0) return -1;
	let low = 0;
	let high = blocks.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (blockBox(blocks[middle]!).bottom < y) low = middle + 1;
		else high = middle;
	}
	if (low === blocks.length) return blocks.length - 1;
	const after = blockBox(blocks[low]!);
	if (low === 0 || after.top <= y) return low;
	const before = blockBox(blocks[low - 1]!);
	return y - before.bottom <= after.top - y ? low - 1 : low;
}
