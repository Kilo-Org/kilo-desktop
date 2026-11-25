import {
	ArrowUpRightIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	SquareIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { BOARD_EVERYONE, type BoardMessage } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { ChatMirrorServices } from "../runtime/chat-mirror";
import type { AgentActivity } from "./agent-activity";
import { AgentAvatar } from "./swarm-parts";
import { isActive, participantName, type TeamMember } from "./swarm-team";
import { useAgentActivity } from "./use-agent-activity";

/** Kilo's board name for the root chat. */
const MAIN = "main";
/** Kilo's board name for the person. */
const USER = "user";

export interface MembersViewProps {
	readonly team: readonly TeamMember[];
	readonly rootChatId: string;
	readonly services: ChatMirrorServices;
	readonly colorOf: (chatId: string) => string;
	/** Loaded board posts. */
	readonly messages: readonly BoardMessage[];
	/** Post id → its #n on the board. */
	readonly numbers: ReadonlyMap<string, number>;
	readonly directoryOf: (chatId: string) => string | undefined;
	readonly updatedAtOf: (chatId: string) => number | undefined;
	readonly costOf?: (chatId: string) => number | undefined;
	readonly onOpen: (chatId: string) => void;
	readonly canOpen: (chatId: string) => boolean;
	/** Filters the board to this agent's posts. */
	readonly onShowPosts: (chatId: string) => void;
	/** Opens the A ↔ B conversation, by board ids (`main` or chat ids). */
	readonly onOpenConversation: (a: string, b: string) => void;
	/** Jumps to the agent's open question on the board. */
	readonly onShowQuestion: (chatId: string) => void;
	/** Stops a member's background job; offered only when it has one. */
	readonly onStop: (member: TeamMember) => void;
}

type StatusWord = "Working" | "Needs you" | "Failed" | "Done" | "Stopped" | "Idle" | "Unknown";

/** One vocabulary for every member: a prompt waiting on the person wins over "busy". */
function statusWord(member: TeamMember): StatusWord {
	if (member.needsYou) return "Needs you";
	switch (member.state) {
		case "working":
		case "retrying":
			return "Working";
		case "failed":
			return "Failed";
		case "done":
			return "Done";
		case "cancelled":
		case "stopped":
			return "Stopped";
		case "idle":
			return "Idle";
		default:
			return "Unknown";
	}
}

const STATUS_TONE: Record<StatusWord, string> = {
	Working: "text-muted-foreground",
	"Needs you": "text-foreground font-medium",
	Failed: "text-destructive",
	Done: "text-foreground/45",
	Stopped: "text-muted-foreground/70",
	Idle: "text-muted-foreground",
	Unknown: "text-muted-foreground/70",
};

const memberName = (member: TeamMember) => (member.main ? "Main agent" : member.title);
const boardIdOf = (member: TeamMember) => (member.main ? MAIN : member.chatId);
const firstLine = (value: string | undefined) =>
	value
		?.split("\n")
		.map((line) => line.trim())
		.find(Boolean) ?? "";

/** "$0.12"; "<$0.01" for a cost too small to show in cents. */
function formatCost(cost: number): string {
	if (cost > 0 && cost < 0.005) return "<$0.01";
	return `$${cost.toFixed(2)}`;
}

interface Partner {
	readonly id: string;
	readonly name: string;
	readonly posts: number;
}

/**
 * Who a member exchanged posts with, both ways, busiest first. Posts to
 * everyone and the person's own messages name no partner.
 */
function partnersOf(
	memberId: string,
	messages: readonly BoardMessage[],
	normalize: (id: string) => string,
	nameOf: (id: string, label: string | undefined) => string,
): Partner[] {
	const posts = new Map<string, { posts: number; label: string | undefined }>();
	for (const message of messages) {
		const from = normalize(message.from);
		const to = normalize(message.to);
		const other = from === memberId ? to : to === memberId ? from : undefined;
		const label = from === memberId ? message.toLabel : message.fromLabel;
		if (!other || other === memberId || other === BOARD_EVERYONE || other === USER) continue;
		const entry = posts.get(other);
		posts.set(other, { posts: (entry?.posts ?? 0) + 1, label: entry?.label ?? label });
	}
	return [...posts]
		.map(([id, entry]) => ({ id, name: nameOf(id, entry.label), posts: entry.posts }))
		.toSorted((a, b) => b.posts - a.posts || a.name.localeCompare(b.name));
}

/** The one line a collapsed row shows for what the member is doing. */
function doingNow(
	member: TeamMember,
	activity: AgentActivity | undefined,
	lastPost: string | undefined,
	teamWorking: boolean,
): string {
	if (member.main && member.state === "idle" && !member.needsYou)
		return teamWorking ? "Waiting on the team" : "Idle";
	if (member.state === "done") return firstLine(lastPost) || "Finished";
	if (isActive(member.state)) return activity?.now ?? (activity ? "Thinking" : "");
	if (member.state === "failed")
		return firstLine(member.error) || firstLine(lastPost) || activity?.now || "";
	return firstLine(lastPost) || activity?.now || "";
}

/** Rows shown before the rest fold behind "Show N more agents". */
const SHOWN_MEMBERS = 4;

/** Who needs a look first: waiting on the person, failed, working; finished last. */
function rank(member: TeamMember): number {
	if (member.needsYou) return 0;
	if (member.state === "failed") return 1;
	if (isActive(member.state)) return 2;
	return 3;
}

/** "all working", "2 working · 1 done": how the folded rows are doing. */
function foldedSummary(members: readonly TeamMember[]): string {
	const counts = new Map<string, number>();
	for (const member of members) {
		const word = statusWord(member).toLowerCase();
		counts.set(word, (counts.get(word) ?? 0) + 1);
	}
	if (counts.size === 1) return `all ${[...counts.keys()][0]}`;
	return [...counts].map(([word, count]) => `${count} ${word}`).join(" · ");
}

/**
 * The Swarm Board's Team list: a row per subagent, those needing a look
 * first, each saying what it does now with a Stop while it works, and
 * expandable to its task, who it talks with on the board, its recent tool
 * calls and its actions. Past four, the rest fold behind one row. Each row
 * reads its chat's messages only while it is open or its member works.
 */
export function MembersView(props: MembersViewProps) {
	const { team, messages, rootChatId } = props;
	const [showAll, setShowAll] = useState(false);
	const normalize = (id: string) => (id === rootChatId ? MAIN : id);
	const nameOf = (id: string, label: string | undefined) => participantName(id, label, team);
	const teamWorking = team.some((member) => !member.main && isActive(member.state));
	const lastPostBy = new Map<string, BoardMessage>();
	for (const message of messages) lastPostBy.set(normalize(message.from), message);
	const workers = team.filter((member) => !member.main).toSorted((a, b) => rank(a) - rank(b));
	const folded = showAll ? [] : workers.slice(SHOWN_MEMBERS);
	const shown = showAll ? workers : workers.slice(0, SHOWN_MEMBERS);
	return (
		<ul className="flex min-w-0 flex-col gap-0.5" data-qa-id="swarm-members">
			{shown.map((member) => (
				<MemberRow
					key={member.chatId}
					{...props}
					member={member}
					teamWorking={teamWorking}
					lastPost={lastPostBy.get(boardIdOf(member))}
					partners={partnersOf(boardIdOf(member), messages, normalize, nameOf)}
				/>
			))}
			{folded.length > 0 ? (
				<li>
					<button
						type="button"
						className="hover:bg-foreground/[0.04] focus-visible:ring-ring flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-start text-[13px] leading-4 outline-none focus-visible:ring-2"
						onClick={() => setShowAll(true)}
						data-qa-id="swarm-members-more"
					>
						<ChevronDownIcon aria-hidden className="text-muted-foreground/70 size-3.5 shrink-0" />
						<span aria-hidden className="w-[26px] shrink-0" />
						<span className="text-muted-foreground shrink-0">
							Show {folded.length} more {folded.length === 1 ? "agent" : "agents"}
						</span>
						<span className="text-muted-foreground/70 truncate">
							· {folded.map((member) => member.title).join(", ")} · {foldedSummary(folded)}
						</span>
					</button>
				</li>
			) : null}
		</ul>
	);
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<section className="flex min-w-0 flex-col gap-1.5">
			<h4 className="text-muted-foreground text-xs font-medium">{title}</h4>
			{children}
		</section>
	);
}

function MemberRow({
	member,
	teamWorking,
	lastPost,
	partners,
	services,
	colorOf,
	numbers,
	directoryOf,
	updatedAtOf,
	costOf,
	onOpen,
	canOpen,
	onShowPosts,
	onOpenConversation,
	onShowQuestion,
	onStop,
}: MembersViewProps & {
	readonly member: TeamMember;
	readonly teamWorking: boolean;
	readonly lastPost: BoardMessage | undefined;
	readonly partners: readonly Partner[];
}) {
	const [open, setOpen] = useState(false);
	const detailsId = useId();
	const active = isActive(member.state);
	const directory = directoryOf(member.chatId);
	const updatedAt = updatedAtOf(member.chatId);
	const activity = useAgentActivity(services, member.chatId, {
		...(directory ? { directory } : {}),
		...(updatedAt !== undefined ? { updatedAt } : {}),
		enabled: open || active,
	});
	const name = memberName(member);
	const word = statusWord(member);
	const finished = member.state === "done";
	const now = doingNow(member, activity, lastPost?.body, teamWorking);
	const postNumber = lastPost ? numbers.get(lastPost.id) : undefined;
	const cost = costOf?.(member.chatId);
	const boardId = boardIdOf(member);
	const question = member.attention?.includes("question") ?? false;
	const showTalking = partners.length > 0 || question;
	return (
		<li
			className="flex min-w-0 flex-col"
			data-qa-id="swarm-member"
			data-chat-id={member.chatId}
			data-state={member.state}
		>
			<div className="hover:bg-foreground/[0.04] flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-2">
				<button
					type="button"
					className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-md text-start text-[13px] leading-4 outline-none focus-visible:ring-2"
					aria-expanded={open}
					aria-controls={detailsId}
					onClick={() => setOpen(!open)}
					data-qa-id="swarm-member-toggle"
				>
					<ChevronRightIcon
						aria-hidden
						className={cn(
							"text-muted-foreground/70 size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
							open && "rotate-90",
						)}
					/>
					<AgentAvatar name={member.title} color={colorOf(member.chatId)} done={!active} />
					<span
						className={cn(
							"w-20 shrink-0 truncate font-medium",
							active || member.needsYou ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{name}
					</span>
					<span
						className={cn(
							"min-w-0 flex-1 truncate",
							active || member.needsYou ? "text-muted-foreground" : "text-muted-foreground/70",
						)}
						title={postNumber && finished ? `#${postNumber} · ${lastPost?.body}` : now}
						data-qa-id="swarm-member-now"
					>
						{now}
					</span>
				</button>
				<span className="flex w-16 shrink-0 items-center justify-end gap-1">
					{active && !member.needsYou ? (
						<span className="sr-only" data-qa-id="swarm-member-status" data-status={word}>
							{word}
						</span>
					) : (
						<span
							className={cn("flex items-center gap-1 text-xs", STATUS_TONE[word])}
							data-qa-id="swarm-member-status"
							data-status={word}
						>
							{word === "Done" ? (
								<CheckIcon aria-hidden className="size-3" strokeWidth={2.4} />
							) : null}
							{word}
						</span>
					)}
					{member.jobId && active ? (
						<Button
							size="icon-xs"
							variant="ghost"
							className="text-muted-foreground size-6"
							aria-label={`Stop ${name}`}
							title={`Stop ${name}`}
							onClick={() => onStop(member)}
							data-qa-id="swarm-member-stop"
						>
							<SquareIcon aria-hidden className="size-2.5 fill-current" />
						</Button>
					) : null}
				</span>
			</div>
			{open ? (
				<div id={detailsId} className="flex min-w-0 flex-col gap-3 ps-[68px] pe-2 pt-1 pb-3">
					{activity?.task ? (
						<Section title="Task">
							<p
								className="line-clamp-4 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
								title={activity.task}
								data-qa-id="swarm-member-task"
							>
								{activity.task}
							</p>
						</Section>
					) : null}
					{member.state === "failed" && (member.error || activity?.editedFiles.length) ? (
						<Section title="What went wrong">
							{member.error ? (
								<p className="text-destructive text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
									{member.error}
								</p>
							) : null}
							{activity?.editedFiles.length ? (
								<p className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
									Its edits are saved: {activity.editedFiles.slice(0, 3).join(", ")}
									{activity.editedFiles.length > 3
										? ` and ${activity.editedFiles.length - 3} more`
										: ""}
								</p>
							) : null}
						</Section>
					) : null}
					{showTalking ? (
						<Section title="Talking with">
							<div className="flex flex-wrap gap-1.5" data-qa-id="swarm-member-talking">
								{partners.map((partner) => (
									<Button
										key={partner.id}
										size="xs"
										variant="outline"
										onClick={() => onOpenConversation(boardId, partner.id)}
										data-partner-id={partner.id}
									>
										<span
											aria-hidden
											className="size-2 shrink-0 rounded-full"
											style={{ backgroundColor: colorOf(partner.id) }}
										/>
										{partner.name} · {partner.posts} {partner.posts === 1 ? "post" : "posts"}
										<ArrowUpRightIcon aria-hidden data-icon="inline-end" />
									</Button>
								))}
								{question ? (
									<Button
										size="xs"
										variant="outline"
										className="border-warning/40 text-warning"
										onClick={() => onShowQuestion(member.chatId)}
										data-qa-id="swarm-member-question"
									>
										you · 1 question
										<ArrowUpRightIcon aria-hidden data-icon="inline-end" />
									</Button>
								) : null}
							</div>
						</Section>
					) : null}
					{activity && activity.steps.length > 0 ? (
						<Section title="Recent activity">
							<dl
								className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-baseline gap-x-3 gap-y-1 text-xs"
								data-qa-id="swarm-member-steps"
							>
								{activity.steps.map((step) => (
									<div key={step.id} className="contents" data-qa-id="swarm-member-step">
										<dt className="text-muted-foreground">{step.tool}</dt>
										<dd className="truncate font-mono" title={step.label}>
											{step.label}
										</dd>
										<dd
											className={cn(
												"text-end tabular-nums",
												step.status === "error" ? "text-destructive" : "text-muted-foreground",
											)}
										>
											{step.status === "running"
												? "running…"
												: step.status === "error"
													? "failed"
													: (step.detail ?? "")}
										</dd>
									</div>
								))}
							</dl>
						</Section>
					) : null}
					{cost !== undefined ? (
						<Section title="Cost">
							<p className="text-sm tabular-nums" data-qa-id="swarm-member-cost">
								{formatCost(cost)}
							</p>
						</Section>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={!canOpen(member.chatId)}
							onClick={() => onOpen(member.chatId)}
							data-qa-id="swarm-member-open"
						>
							Open {name}
							<ArrowUpRightIcon aria-hidden data-icon="inline-end" />
						</Button>
						<Button
							size="sm"
							variant="link"
							className="px-1"
							onClick={() => onShowPosts(member.chatId)}
							data-qa-id="swarm-member-show-posts"
						>
							Show posts on board
						</Button>
					</div>
				</div>
			) : null}
		</li>
	);
}
