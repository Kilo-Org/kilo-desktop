import type { BoardMessageType } from "@kilo-desktop/plugin-core/contracts";

/** An agent on the Graph: the main agent (`main`) or a worker, by chat id. */
export interface GraphMember {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	readonly done: boolean;
}

/** One board post, reduced to what the Graph draws. */
export interface GraphPost {
	readonly id: string;
	/** The post's `#n` on the board. */
	readonly seq: number;
	/** `main` or a chat id. */
	readonly from: string;
	/** `main`, a chat id, or `ALL`. */
	readonly to: string;
	readonly type: BoardMessageType;
	readonly timestamp: number;
}

/** The posts exchanged between two members, in either direction. */
export interface GraphEdge {
	/** The pair, unordered: `a` comes before `b` in the members' order. */
	readonly a: string;
	readonly b: string;
	/** In board order. */
	readonly posts: readonly GraphPost[];
	/** Any HOLD or VETO among them. */
	readonly blocking: boolean;
}

/** An inclusive span of time, in epoch milliseconds. */
export interface GraphWindow {
	readonly from: number;
	readonly to: number;
}

const EVERYONE = "ALL";
const isBlocking = (type: BoardMessageType) => type === "HOLD" || type === "VETO";

/**
 * Who talked to whom: an edge per pair of members that exchanged posts, a
 * post to everyone counting toward the sender's edge with every other member.
 * Posts from or to someone who isn't a member (the person, an agent no longer
 * listed) and posts to oneself are left out. `inWindow` holds the drawn posts
 * that fall in `window` (all of them without one).
 */
export function graphEdges(
	members: readonly GraphMember[],
	posts: readonly GraphPost[],
	window?: GraphWindow,
): { edges: GraphEdge[]; inWindow: ReadonlySet<string> } {
	const order = new Map(members.map((member, index) => [member.id, index]));
	const byPair = new Map<string, { a: string; b: string; posts: GraphPost[] }>();
	const inWindow = new Set<string>();
	const sorted = posts.toSorted((x, y) => x.seq - y.seq);
	for (const post of sorted) {
		const from = order.get(post.from);
		if (from === undefined) continue;
		const recipients =
			post.to === EVERYONE
				? members.map((_, index) => index).filter((index) => index !== from)
				: [order.get(post.to)].filter(
						(index): index is number => index !== undefined && index !== from,
					);
		if (recipients.length === 0) continue;
		if (!window || (post.timestamp >= window.from && post.timestamp <= window.to)) {
			inWindow.add(post.id);
		}
		for (const to of recipients) {
			const [low, high] = from < to ? [from, to] : [to, from];
			const key = `${low}:${high}`;
			const edge = byPair.get(key) ?? {
				a: members[low]!.id,
				b: members[high]!.id,
				posts: [],
			};
			edge.posts.push(post);
			byPair.set(key, edge);
		}
	}
	const edges = [...byPair.values()]
		.toSorted((x, y) => order.get(x.a)! - order.get(y.a)! || order.get(x.b)! - order.get(y.b)!)
		.map((edge) => ({ ...edge, blocking: edge.posts.some((post) => isBlocking(post.type)) }));
	return { edges, inWindow };
}

/** The main agent's id among the members. */
export const MAIN_MEMBER = "main";

/** Room kept clear above and below the nodes, in pixels. */
const PAD_Y = 24;
/** Room kept clear at the sides, for the outermost nodes' name labels. */
const padX = (width: number) => Math.min(140, Math.max(48, width * 0.2));

/**
 * Where each member sits in a `width` × `height` area: the main agent at the
 * top centre, the others evenly along an arc below it, in the members' order
 * from left to right (one worker sits straight below the main agent).
 */
export function graphLayout(
	members: readonly GraphMember[],
	width: number,
	height: number,
): ReadonlyMap<string, { x: number; y: number }> {
	const cx = width / 2;
	const top = PAD_Y;
	const rx = Math.max(0, width / 2 - padX(width));
	const ry = Math.max(0, height - PAD_Y * 2);
	const others = members.filter((member) => member.id !== MAIN_MEMBER);
	const positions = new Map<string, { x: number; y: number }>();
	if (others.length < members.length) positions.set(MAIN_MEMBER, { x: cx, y: top });
	others.forEach((member, index) => {
		const angle = Math.PI - ((index + 1) / (others.length + 1)) * Math.PI;
		positions.set(member.id, {
			x: cx + rx * Math.cos(angle),
			y: top + ry * Math.sin(angle),
		});
	});
	return positions;
}
