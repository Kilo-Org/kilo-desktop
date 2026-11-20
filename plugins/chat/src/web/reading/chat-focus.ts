import {
	readingBlocks,
	blockIndexAt,
	type ReadingBlock,
} from "@kilo-desktop/ui/lib/reading/blocks";
import {
	ReadingFocusController,
	type FocusSource as GenericFocusSource,
	type ReadingFocusSession,
} from "@kilo-desktop/ui/lib/reading/focus-controller";

export type {
	FocusEntrySource,
	FocusExitReason,
} from "@kilo-desktop/ui/lib/reading/focus-controller";

/**
 * Where Focus starts (and where reading stopped): a paragraph of a message in
 * the chat, by its index among the message's reply blocks (0 in a prompt), or
 * a plan's body. Focus on a chat shows the whole conversation.
 */
export type ChatFocusTarget =
	| { readonly kind: "reply"; readonly messageId: string; readonly block: number }
	| { readonly kind: "plan"; readonly block: number };

export type ChatFocusSession = ReadingFocusSession<ChatFocusTarget>;
export type FocusSource = GenericFocusSource<ChatFocusTarget>;
export class ChatFocus extends ReadingFocusController<ChatFocusTarget> {}

/** Reading blocks of reply text under an element (answer text only; folded narration is not marked). */
export function replyBlocks(root: Element): ReadingBlock[] {
	return [...root.querySelectorAll('[data-reading-surface="reply"]')].flatMap((surface) =>
		readingBlocks(surface),
	);
}

const MESSAGE = "[data-message-id]";
const REPLY_SURFACE = '[data-reading-surface="reply"]';

const messageOf = (block: ReadingBlock) => block.elements[0]?.closest<HTMLElement>(MESSAGE) ?? null;

/**
 * A reply target's index among the whole chat's blocks in Focus: its
 * paragraph, else its message's first block, else the latest block.
 */
export function chatBlockIndex(
	blocks: readonly ReadingBlock[],
	target: Extract<ChatFocusTarget, { kind: "reply" }>,
): number {
	let first = -1;
	let replyBlock = 0;
	for (const [index, block] of blocks.entries()) {
		if (messageOf(block)?.dataset.messageId !== target.messageId) continue;
		if (first < 0) first = index;
		if (!block.elements[0]!.closest(REPLY_SURFACE)) continue;
		if (replyBlock === target.block) return index;
		replyBlock += 1;
	}
	return first >= 0 ? first : blocks.length - 1;
}

/** The reply target a block of the chat in Focus belongs to (block 0 in a prompt). */
export function chatTargetOf(block: ReadingBlock): ChatFocusTarget | null {
	const message = messageOf(block);
	const messageId = message?.dataset.messageId;
	if (!message || !messageId) return null;
	const index = replyBlocks(message).findIndex(
		(candidate) => candidate.elements[0] === block.elements[0],
	);
	return { kind: "reply", messageId, block: Math.max(0, index) };
}

/**
 * The reply block nearest the vertical middle of a transcript's viewport, as
 * a Focus target; else the latest reply's first block. Null without replies.
 */
export function replyTargetNearMiddle(viewport: Element | null): ChatFocusTarget | null {
	if (!viewport) return null;
	const box = viewport.getBoundingClientRect();
	const middle = box.top + box.height / 2;
	const all = replyBlocks(viewport).filter((block) => {
		const { top, bottom } = block.elements[0]!.getBoundingClientRect();
		return bottom > box.top && top < box.bottom;
	});
	const index = blockIndexAt(all, middle);
	const near = all[index];
	if (near) {
		const message = near.elements[0]!.closest<HTMLElement>(MESSAGE);
		if (message?.dataset.messageId) {
			const block = replyBlocks(message).findIndex(
				(candidate) => candidate.elements[0] === near.elements[0],
			);
			return { kind: "reply", messageId: message.dataset.messageId, block: Math.max(0, block) };
		}
	}
	const surfaces = viewport.querySelectorAll('[data-reading-surface="reply"]');
	const last = surfaces[surfaces.length - 1]?.closest<HTMLElement>(MESSAGE);
	return last?.dataset.messageId
		? { kind: "reply", messageId: last.dataset.messageId, block: 0 }
		: null;
}

/** Scrolls a reply's block (for a prompt, its message) to the middle of the transcript. */
export function revealReplyBlock(viewport: Element | null, messageId: string, block: number): void {
	if (!viewport) return;
	const message = viewport.querySelector<HTMLElement>(
		`[data-message-id="${CSS.escape(messageId)}"]`,
	);
	if (!message) return;
	const target = replyBlocks(message)[block]?.elements[0] ?? message;
	target.scrollIntoView({ block: "center" });
}
