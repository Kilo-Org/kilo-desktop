import { AvatarGroup, AvatarGroupCount } from "@kilo-desktop/ui/components/avatar";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { MAIN_AGENT_COLOR, WORKER_COLORS } from "./swarm-colors";
import { AgentAvatar } from "./swarm-parts";
import { isActive, type TeamMember } from "./swarm-team";

/** Faces shown before the rest fold into "+N", as the transcript's tool icons do. */
const MAX_FACES = 5;

const faceName = (member: TeamMember) => (member.main ? "Main agent" : member.title);

function faceState(member: TeamMember): string {
	if (member.needsYou) return "needs you";
	if (isActive(member.state)) return "working";
	return member.main ? "idle" : "finished";
}

/**
 * A team as a row of agent icons overlapping like the transcript's tool
 * icons: the main agent first, a working worker as its monster in its
 * colour, a stopped one grey, one waiting on the person ringed in the text
 * colour; past five, a "+N" count leads. With `onOpen` the workers' icons
 * are buttons.
 */
export function SwarmFaces({
	team,
	colors,
	onOpen,
	faceQaId,
	size = "md",
	className,
}: {
	readonly team: readonly TeamMember[];
	readonly colors: ReadonlyMap<string, string>;
	readonly onOpen?: (member: TeamMember) => void;
	readonly faceQaId?: string;
	/** `md` (26px, the tool icons' size) or `sm` (20px) in tight spots. */
	readonly size?: "sm" | "md";
	/** Sets the ring between icons to the surface behind them (default: the pane). */
	readonly className?: string;
}) {
	const shown = team.slice(0, MAX_FACES);
	const folded = team.slice(MAX_FACES);
	return (
		<AvatarGroup
			className={cn("*:data-[slot=avatar]:ring-pane shrink-0 -space-x-1", className)}
			data-qa-id="swarm-faces"
		>
			{shown.map((member, index) => {
				const name = faceName(member);
				const color =
					colors.get(member.chatId) ??
					(member.main
						? MAIN_AGENT_COLOR
						: WORKER_COLORS[Math.max(index - 1, 0) % WORKER_COLORS.length]!);
				const title = `${name}: ${faceState(member)}`;
				const avatar = (
					<AgentAvatar
						key={member.chatId}
						name={title}
						color={color}
						size={size}
						done={!member.main && !member.needsYou && !isActive(member.state)}
						className={cn(
							"relative",
							member.needsYou &&
								"*:data-[slot=avatar-fallback]:ring-foreground *:data-[slot=avatar-fallback]:ring-[1.5px]",
						)}
					/>
				);
				if (!onOpen || member.main) return avatar;
				return (
					<button
						key={member.chatId}
						type="button"
						data-slot="avatar"
						className="focus-visible:ring-ring relative rounded-full outline-none hover:z-10 focus-visible:z-10"
						aria-label={`Open ${name} (${faceState(member)})`}
						title={title}
						onClick={() => onOpen(member)}
						data-qa-id={faceQaId}
						data-state={member.needsYou ? "needs-you" : member.state}
					>
						{avatar}
					</button>
				);
			})}
			{folded.length > 0 ? (
				<AvatarGroupCount
					className={cn("ring-pane order-first text-xs", size === "sm" ? "size-5" : "size-6.5")}
					title={folded.map((member) => faceName(member)).join(", ")}
				>
					+{folded.length}
				</AvatarGroupCount>
			) : null}
		</AvatarGroup>
	);
}
