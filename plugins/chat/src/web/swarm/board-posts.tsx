import {
	ArrowUpRightIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CopyIcon,
	CornerDownRightIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@kilo-desktop/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import { cn } from "@kilo-desktop/ui/lib/utils";
import type { MarkdownRendererExtension } from "@kilo-desktop/ui/lib/markdown-extension";

import { highlightExtension } from "./remark-highlight";
import { AgentAvatar, ColorName } from "./swarm-parts";
import { relativeTime } from "./swarm-time";

export function MessageTypeLabel({ type }: { readonly type: BoardMessage["type"] }) {
	return (
		<Badge variant={type === "VETO" ? "destructive" : "outline"}>
			{type === "HOLD" ? <TriangleAlertIcon aria-hidden data-icon="inline-start" /> : null}
			{type}
		</Badge>
	);
}

/** Posts longer than this start folded (all but the newest), so the board scans. */
const LONG_POST_CHARS = 480;
const LONG_POST_LINES = 8;

export const isLong = (body: string) =>
	body.length > LONG_POST_CHARS || body.split("\n").length > LONG_POST_LINES;

/** A post's first line of text, without markdown marks. */
export function preview(body: string): string {
	const line = body.split("\n").find((candidate) => candidate.trim()) ?? "";
	return (
		line
			.replace(/^[#>*\-\s]+/, "")
			.replace(/[`*]/g, "")
			// Emphasis underscores sit at word edges; identifiers keep theirs (count_envs).
			.replace(/(^|\W)_+|_+(?=\W|$)/g, "$1")
			.trim()
	);
}

/** What every post on the board shares: how its sender and recipient are shown, and the clock. */
export interface PostContext {
	readonly nameOf: (id: string, label?: string) => string;
	readonly colorOf: (id: string) => string;
	readonly now: number;
	/** The search, highlighted in bodies. */
	readonly query: string;
	/** Markdown extensions for bodies (workspace file links). */
	readonly extensions: readonly MarkdownRendererExtension[];
	readonly onOpenSender: (from: string) => void;
	readonly canOpenSender?: (from: string) => boolean;
	readonly onCopy: (text: string) => Promise<void>;
}

function FoldToggle({
	folded,
	onToggle,
	searchMatch = false,
}: {
	readonly folded: boolean;
	readonly onToggle: () => void;
	readonly searchMatch?: boolean;
}) {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			className="text-muted-foreground shrink-0"
			aria-label={folded ? "Expand message" : "Collapse message"}
			aria-expanded={!folded}
			disabled={searchMatch}
			title={searchMatch ? "Clear search to collapse this message" : undefined}
			data-qa-id="swarm-board-message-toggle"
			onClick={onToggle}
		>
			{folded ? <ChevronRightIcon /> : <ChevronDownIcon />}
		</Button>
	);
}

function CopyButton({
	text,
	onCopy,
	label,
}: {
	readonly text: string;
	readonly onCopy: PostContext["onCopy"];
	readonly label?: string;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			size={label ? "xs" : "icon-xs"}
			variant="ghost"
			className="shrink-0"
			aria-label={copied ? "Copied" : (label ?? "Copy message")}
			data-qa-id="swarm-board-message-copy"
			onClick={() =>
				void onCopy(text).then(
					() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 2_000);
					},
					() => undefined,
				)
			}
		>
			{copied ? (
				<CheckIcon data-icon={label ? "inline-start" : undefined} />
			) : (
				<CopyIcon data-icon={label ? "inline-start" : undefined} />
			)}
			{label ? (copied ? "Copied" : label) : null}
		</Button>
	);
}

function PostMeta({
	message,
	open,
	context,
}: {
	readonly message: BoardMessage;
	readonly open: boolean;
	readonly context: PostContext;
}) {
	const toEveryone = message.to === "ALL";
	return (
		<span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
			<MessageTypeLabel type={message.type} />
			{open ? (
				<Badge variant="secondary" data-qa-id="swarm-board-message-open">
					No reply yet
				</Badge>
			) : null}
			<span className="inline-flex min-w-0 items-center gap-1">
				→{" "}
				<ColorName
					name={context.nameOf(message.to, message.toLabel)}
					color={toEveryone ? undefined : context.colorOf(message.to)}
				/>
			</span>
			<time
				className="tabular-nums"
				dateTime={new Date(message.timestamp).toISOString()}
				title={new Date(message.timestamp).toLocaleString()}
			>
				{relativeTime(message.timestamp, context.now)}
			</time>
		</span>
	);
}

/** Neutral post bodies reserve color emphasis for warnings, with identity in the avatar. */
export function AgentPost({
	message,
	context,
	open,
	folded,
	onToggle,
	replyTo,
	children,
}: {
	readonly message: BoardMessage;
	readonly context: PostContext;
	readonly open: boolean;
	readonly folded: boolean;
	readonly onToggle: () => void;
	/** The body of the post it answers, quoted (when replies aren't threaded). */
	readonly replyTo?: string | undefined;
	/** Its thread's replies. */
	readonly children?: ReactNode;
}) {
	const color = context.colorOf(message.from);
	const name = context.nameOf(message.from, message.fromLabel);
	const query = context.query.trim().toLowerCase();
	const searchMatch = query !== "" && message.body.toLowerCase().includes(query);
	const showPreview = folded && !searchMatch;
	const sender = (
		<>
			<AgentAvatar name={name} color={color} />
			<span className="truncate">{name}</span>
		</>
	);
	const highlight = highlightExtension(context.query);
	const extensions = highlight ? [...context.extensions, highlight] : context.extensions;
	return (
		<li
			className="group/post flex scroll-mt-4 flex-col gap-1.5"
			tabIndex={-1}
			data-qa-id="swarm-board-message"
			data-type={message.type}
			data-message-id={message.id}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				{context.canOpenSender?.(message.from) !== false ? (
					<Button
						size="sm"
						variant="ghost"
						className="max-w-full min-w-0 justify-start"
						onClick={() => context.onOpenSender(message.from)}
						title="Open transcript"
						data-qa-id="swarm-board-message-sender"
					>
						{sender}
					</Button>
				) : (
					<span
						className="flex min-w-0 items-center gap-2 text-sm font-medium"
						data-qa-id="swarm-board-message-sender"
					>
						{sender}
					</span>
				)}
				<PostMeta message={message} open={open} context={context} />
				<span className="ms-auto" />
				<CopyButton text={message.body} onCopy={context.onCopy} />
				<FoldToggle folded={showPreview} onToggle={onToggle} searchMatch={searchMatch} />
			</div>
			<div
				className={cn(
					"border-border ms-3 min-w-0 rounded-e-lg border-s-2 py-1.5 ps-4 pe-3",
					message.type === "HOLD" && "border-warning bg-warning-surface",
					message.type === "VETO" && "border-destructive bg-destructive/5",
				)}
			>
				{replyTo ? (
					<p className="text-muted-foreground mb-1 flex min-w-0 items-center gap-1 text-xs">
						<CornerDownRightIcon aria-hidden className="size-3 shrink-0" />
						<span className="truncate">{preview(replyTo)}</span>
					</p>
				) : null}
				{showPreview ? (
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground block w-full truncate text-start text-sm"
						onClick={onToggle}
						data-qa-id="swarm-board-message-preview"
					>
						{preview(message.body)}
					</button>
				) : (
					<MarkdownContent
						text={message.body}
						extensions={extensions}
						className="min-w-0 text-sm wrap-break-word"
					/>
				)}
			</div>
			{!showPreview ? (
				<span aria-hidden className="h-px" data-read-message-id={message.id} />
			) : null}
			{children}
		</li>
	);
}

/** A thread's replies under the post they answer, folded to a count. */
export function ThreadReplies({
	count,
	newCount,
	open,
	onToggle,
	children,
}: {
	readonly count: number;
	/** Replies the person hasn't seen. */
	readonly newCount: number;
	readonly open: boolean;
	readonly onToggle: () => void;
	readonly children: ReactNode;
}) {
	return (
		<div className="ms-7 flex flex-col gap-3" data-qa-id="swarm-board-thread">
			<button
				type="button"
				className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs"
				aria-expanded={open}
				onClick={onToggle}
				data-qa-id="swarm-board-thread-toggle"
			>
				{open ? (
					<ChevronDownIcon aria-hidden className="size-3" />
				) : (
					<ChevronRightIcon aria-hidden className="size-3" />
				)}
				{count === 1 ? "1 reply" : `${count} replies`}
				{newCount > 0 ? (
					<span className="text-primary-ink font-medium" data-qa-id="swarm-board-thread-new">
						· {newCount} new
					</span>
				) : null}
			</button>
			{open ? <ol className="flex flex-col gap-4">{children}</ol> : null}
		</div>
	);
}

/** Where the posts the person hasn't seen start. */
export function NewMessagesDivider() {
	return (
		<li
			className="text-primary-ink flex items-center gap-2 text-xs font-medium"
			data-qa-id="swarm-board-new-divider"
			aria-label="New messages"
		>
			<span className="bg-primary/40 h-px flex-1" />
			New
			<span className="bg-primary/40 h-px flex-1" />
		</li>
	);
}

/** The latest loaded RESULT from each agent, reported by agents rather than verified by the app. */
export function ResultsDigest({
	results,
	context,
	onJump,
	loadedCount,
	hasMore = false,
}: {
	readonly results: readonly BoardMessage[];
	readonly context: PostContext;
	readonly onJump: (messageId: string) => void;
	readonly loadedCount?: number;
	readonly hasMore?: boolean;
}) {
	return (
		<section
			aria-label="Results"
			className="flex min-w-0 flex-col gap-4"
			data-qa-id="swarm-board-results"
		>
			<header className="flex flex-col gap-1">
				<h3 className="text-sm font-medium">Agent-reported results</h3>
				<p className="text-muted-foreground text-xs">
					Latest result per agent from{" "}
					{loadedCount === undefined
						? "loaded messages"
						: `${loadedCount} loaded ${loadedCount === 1 ? "message" : "messages"}`}
					. Not independently verified.
					{hasMore ? " Older messages are not included." : ""}
				</p>
			</header>
			{results.length > 0 ? (
				<ul className="flex min-w-0 flex-col gap-3">
					{results.map((result) => (
						<li key={result.id} data-qa-id="swarm-board-result">
							<Card size="sm">
								<CardHeader>
									<CardTitle className="flex min-w-0 items-center gap-2">
										<AgentAvatar
											name={context.nameOf(result.from, result.fromLabel)}
											color={context.colorOf(result.from)}
										/>
										<span className="min-w-0 break-words">
											{context.nameOf(result.from, result.fromLabel)}
										</span>
									</CardTitle>
									<CardDescription>
										<time
											dateTime={new Date(result.timestamp).toISOString()}
											title={new Date(result.timestamp).toLocaleString()}
										>
											{relativeTime(result.timestamp, context.now)}
										</time>
									</CardDescription>
								</CardHeader>
								<CardContent className="min-w-0">
									<MarkdownContent
										text={result.body}
										extensions={context.extensions}
										className="min-w-0 text-sm wrap-break-word"
									/>
								</CardContent>
								<CardFooter className="flex-wrap gap-2">
									<Button
										size="xs"
										variant="outline"
										onClick={() => onJump(result.id)}
										data-qa-id="swarm-board-result-source"
									>
										<ArrowUpRightIcon aria-hidden data-icon="inline-start" />
										View source message
									</Button>
									<CopyButton text={result.body} onCopy={context.onCopy} label="Copy result" />
								</CardFooter>
							</Card>
						</li>
					))}
				</ul>
			) : (
				<Empty data-qa-id="swarm-board-results-empty">
					<EmptyHeader>
						<EmptyTitle>No results in loaded messages</EmptyTitle>
						<EmptyDescription>
							Results appear when an agent posts a RESULT to the board.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</section>
	);
}
