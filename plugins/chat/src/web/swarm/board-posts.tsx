import {
	ArrowRightIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleAlertIcon,
	CornerDownRightIcon,
	OctagonXIcon,
	SquareIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import { cn } from "@kilo-desktop/ui/lib/utils";
import type { MarkdownRendererExtension } from "@kilo-desktop/ui/lib/markdown-extension";

import { highlightExtension } from "./remark-highlight";
import { AgentAvatar } from "./swarm-parts";
import type { TeamMember } from "./swarm-team";
import { clockTime, duration, postTime } from "./swarm-time";

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

/** The tag a post that blocks someone carries; other types read from the prose. */
export function blockingTag(type: BoardMessage["type"]): string | undefined {
	if (type === "HOLD") return "Asked to wait";
	if (type === "VETO") return "Vetoed";
	return undefined;
}

/** What every post on the board shares: how agents are shown, the clock, and the board's numbers. */
export interface PostContext {
	readonly nameOf: (id: string, label?: string) => string;
	readonly colorOf: (id: string) => string;
	readonly now: number;
	/** Each loaded post's `#n`. */
	readonly numbers: ReadonlyMap<string, number>;
	/** The search, highlighted in bodies. */
	readonly query: string;
	/** Markdown extensions for bodies (file links, `#n` chips). */
	readonly extensions: readonly MarkdownRendererExtension[];
	/** The team member who sent a post, for its Stop / Done control. */
	readonly memberOf: (from: string) => TeamMember | undefined;
	readonly onOpenSender: (from: string) => void;
	readonly canOpenSender: (from: string) => boolean;
	readonly onStop: (member: TeamMember) => void;
	readonly onJump: (messageId: string) => void;
}

/** The control on the right of a post: stop its sender while it works, or say it's done. */
function SenderControl({ member, onStop }: { member: TeamMember; onStop: PostContext["onStop"] }) {
	if (member.state === "done") {
		return (
			<span
				className="text-muted-foreground flex items-center gap-1 text-xs"
				data-qa-id="swarm-board-message-done"
			>
				<CheckIcon aria-hidden className="size-3" /> Done
			</span>
		);
	}
	if (!member.jobId) return null;
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			className="text-muted-foreground"
			aria-label={`Stop ${member.title}`}
			title={`Stop ${member.title}`}
			onClick={() => onStop(member)}
			data-qa-id="swarm-board-message-stop"
		>
			<SquareIcon className="fill-current" />
		</Button>
	);
}

/** Sender → recipient, an avatar, and the post's number and time: one post as a chat message. */
export function BoardPost({
	message,
	context,
	folded,
	onToggle,
	foldable,
	isNew,
}: {
	readonly message: BoardMessage;
	readonly context: PostContext;
	readonly folded: boolean;
	readonly onToggle: () => void;
	readonly foldable: boolean;
	readonly isNew: boolean;
}) {
	const color = context.colorOf(message.from);
	const name = context.nameOf(message.from, message.fromLabel);
	const toEveryone = message.to === "ALL";
	const recipient = toEveryone ? "everyone" : context.nameOf(message.to, message.toLabel);
	const number = context.numbers.get(message.id);
	const replyNumber = message.replyTo ? context.numbers.get(message.replyTo) : undefined;
	const tag = blockingTag(message.type);
	const member = context.memberOf(message.from);
	const query = context.query.trim().toLowerCase();
	const searchMatch = query !== "" && message.body.toLowerCase().includes(query);
	const showPreview = folded && !searchMatch;
	const highlight = highlightExtension(context.query);
	const extensions = highlight ? [...context.extensions, highlight] : context.extensions;
	const canOpen = context.canOpenSender(message.from);
	return (
		<li
			className="group/post flex scroll-mt-4 gap-3 rounded-md"
			tabIndex={-1}
			data-qa-id="swarm-board-message"
			data-type={message.type}
			data-message-id={message.id}
			data-new={isNew || undefined}
		>
			<AgentAvatar
				name={name}
				color={color}
				done={
					!!member &&
					!member.main &&
					["done", "cancelled", "stopped", "failed"].includes(member.state)
				}
			/>
			<div className={cn("flex min-w-0 flex-1 flex-col", tag ? "gap-1.5" : "gap-1")}>
				<div className="flex min-h-4 min-w-0 items-center gap-1.5 text-[13px] leading-4">
					{canOpen ? (
						<button
							type="button"
							className="truncate font-semibold hover:underline"
							onClick={() => context.onOpenSender(message.from)}
							title={`Open ${name}`}
							data-qa-id="swarm-board-message-sender"
						>
							{name}
						</button>
					) : (
						<span className="truncate font-semibold" data-qa-id="swarm-board-message-sender">
							{name}
						</span>
					)}
					<span aria-hidden className="text-muted-foreground/80 shrink-0">
						→
					</span>
					<span
						className="text-muted-foreground/80 -ms-0.5 truncate"
						data-qa-id="swarm-board-message-recipient"
					>
						{recipient}
					</span>
					{tag ? (
						<span
							className={cn(
								"ms-1 flex shrink-0 items-center gap-1 rounded-full px-[7px] py-px text-xs leading-4",
								message.type === "VETO"
									? "bg-destructive/12 text-destructive"
									: "bg-foreground/8 text-foreground",
							)}
							data-qa-id="swarm-board-message-tag"
						>
							{message.type === "VETO" ? (
								<OctagonXIcon aria-hidden className="size-2.5" />
							) : (
								<svg aria-hidden viewBox="0 0 24 24" className="size-2.5 fill-current">
									<rect x="6" y="5" width="4" height="14" rx="1" />
									<rect x="14" y="5" width="4" height="14" rx="1" />
								</svg>
							)}
							{tag}
						</span>
					) : null}
					<span className="ms-auto flex shrink-0 items-center gap-1 ps-2">
						<span className="text-muted-foreground/80 text-xs tabular-nums">
							{number !== undefined ? `#${number} · ` : ""}
							<time
								dateTime={new Date(message.timestamp).toISOString()}
								title={new Date(message.timestamp).toLocaleString()}
							>
								{postTime(message.timestamp, context.now)}
							</time>
						</span>
						{member && !member.main ? (
							<SenderControl member={member} onStop={context.onStop} />
						) : null}
						{foldable ? (
							<Button
								size="icon-xs"
								variant="ghost"
								className="text-muted-foreground"
								aria-label={showPreview ? "Expand post" : "Collapse post"}
								aria-expanded={!showPreview}
								disabled={searchMatch}
								onClick={onToggle}
								data-qa-id="swarm-board-message-toggle"
							>
								{showPreview ? <ChevronRightIcon /> : <ChevronDownIcon />}
							</Button>
						) : null}
					</span>
				</div>
				{replyNumber !== undefined ? (
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs"
						onClick={() => context.onJump(message.replyTo!)}
						data-qa-id="swarm-board-message-reply"
					>
						<CornerDownRightIcon aria-hidden className="size-3" />
						Reply to #{replyNumber}
					</button>
				) : null}
				<div
					className={cn(
						"min-w-0",
						tag &&
							"ps-3 shadow-[inset_2px_0_0_color-mix(in_srgb,var(--foreground)_35%,transparent)]",
					)}
				>
					{showPreview ? (
						<button
							type="button"
							className="text-muted-foreground hover:text-foreground block w-full truncate text-start text-sm leading-[21px]"
							onClick={onToggle}
							data-qa-id="swarm-board-message-preview"
						>
							{preview(message.body)}
						</button>
					) : (
						<MarkdownContent
							text={message.body}
							extensions={extensions}
							className="text-foreground/85 [&_:not(pre)>code]:text-foreground min-w-0 text-sm leading-[21px] wrap-break-word [&_:not(pre)>code]:bg-transparent [&_:not(pre)>code]:p-0 [&_:not(pre)>code]:text-xs"
						/>
					)}
				</div>
				{!showPreview ? (
					<span aria-hidden className="h-px" data-read-message-id={message.id} />
				) : null}
			</div>
		</li>
	);
}

/** Something waiting on the person, in the feed where it happened: a question or a permission prompt. */
export function NeedsYouItem({
	member,
	color,
	children,
}: {
	readonly member: { readonly title: string; readonly main: boolean };
	readonly color: string;
	readonly children: ReactNode;
}) {
	const name = member.main ? "Main agent" : member.title;
	return (
		<li className="flex gap-3" data-qa-id="swarm-board-needs-you">
			<div className="pt-0.5">
				<span className="ring-foreground ring-offset-pane flex rounded-full ring-2 ring-offset-2">
					<AgentAvatar name={name} color={color} />
				</span>
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex min-w-0 items-center gap-1.5 text-sm">
					<span className="truncate font-medium">{name}</span>
					<ArrowRightIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />
					<span className="font-medium">you</span>
					<span className="text-muted-foreground ms-auto text-xs">waiting</span>
				</div>
				{children}
			</div>
		</li>
	);
}

/** A worker that failed, with what's known and the next step. */
export function FailedAgentCard({
	member,
	editedFiles,
	onOpen,
	canOpen,
}: {
	readonly member: TeamMember;
	readonly editedFiles: readonly string[];
	readonly onOpen: () => void;
	readonly canOpen: boolean;
}) {
	const error = (member.error ?? "It stopped with an error.").trim();
	const edits =
		editedFiles.length > 0
			? ` Its edits to ${editedFiles.slice(0, 2).join(", ")}${editedFiles.length > 2 ? ` and ${editedFiles.length - 2} more` : ""} are saved; the main agent has been told.`
			: " The main agent has been told.";
	return (
		<li
			className="bg-destructive/[0.06] ring-destructive/25 flex flex-col gap-2.5 rounded-[10px] p-3.5 ring-1 ring-inset"
			data-qa-id="swarm-board-failed"
		>
			<div className="flex items-center gap-2">
				<CircleAlertIcon aria-hidden className="text-destructive size-3.5 shrink-0" />
				<span className="text-[13px] leading-4 font-semibold">{member.title} failed</span>
				<span className="flex-1" />
				{member.completedAt ? (
					<span className="text-muted-foreground/80 text-xs tabular-nums">
						{clockTime(member.completedAt)}
					</span>
				) : null}
			</div>
			<p className="text-[13px] leading-[19px]">
				{/[.!?]$/.test(error) ? error : `${error}.`}
				{edits}
			</p>
			<div className="flex justify-end">
				<button
					type="button"
					className="ring-foreground/16 hover:bg-muted focus-visible:ring-ring rounded-[7px] px-[11px] py-[5px] text-xs leading-4 ring-1 outline-none ring-inset focus-visible:ring-2 disabled:opacity-50"
					disabled={!canOpen}
					onClick={onOpen}
					data-qa-id="swarm-board-failed-open"
				>
					Open transcript
				</button>
			</div>
		</li>
	);
}

/** "Tests is writing…": an agent posting to the board right now. */
export function WritingIndicator({ name }: { readonly name: string }) {
	return (
		<li
			className="flex items-center gap-2.5 ps-10 text-[13px] leading-4"
			data-qa-id="swarm-board-writing"
		>
			<span aria-hidden className="flex gap-[3px]">
				{[1, 0.6, 0.3].map((opacity, index) => (
					<span
						key={opacity}
						className="bg-muted-foreground size-[5px] rounded-full motion-safe:animate-pulse"
						style={{ opacity, animationDelay: `${index * 150}ms` }}
					/>
				))}
			</span>
			<span className="text-foreground/85">{name}</span>
			<span className="text-muted-foreground -ms-1">is writing…</span>
		</li>
	);
}

/** The end of the swarm: everyone stopped. */
export function SwarmDoneMarker({
	finishedAt,
	agents,
	took,
}: {
	readonly finishedAt: number | undefined;
	readonly agents: number;
	readonly took: number | undefined;
}) {
	return (
		<li
			className="text-muted-foreground flex items-center gap-2 text-xs"
			data-qa-id="swarm-board-done"
		>
			<span className="bg-border h-px flex-1" />
			<CheckIcon aria-hidden className="size-3" />
			Swarm done
			{finishedAt ? ` · ${clockTime(finishedAt)}` : ""} · {agents}{" "}
			{agents === 1 ? "agent" : "agents"}
			{took !== undefined ? ` · ${duration(took)}` : ""}
			<span className="bg-border h-px flex-1" />
		</li>
	);
}

/** Where the posts the person hasn't seen start. */
export function NewPostsDivider({ count }: { readonly count: number }) {
	return (
		<li
			className="text-muted-foreground flex items-center gap-2.5 text-xs"
			data-qa-id="swarm-board-new-divider"
		>
			<span className="bg-border h-px flex-1" />
			{count} new since you looked
			<span className="bg-border h-px flex-1" />
		</li>
	);
}
