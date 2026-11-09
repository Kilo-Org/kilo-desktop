import type { ChatCue } from "./chat-notifier";

const C5 = 523.25;
const G5 = 783.99;

/**
 * One soft two-note bell for both cues, told apart by direction:
 * "done" falls a fifth (settles), "needs you" rises a fifth (asks) and is a
 * touch louder. Both stay under ~0.6s so they can play dozens of times a day.
 */
const CUES: Record<ChatCue, { gain: number; first: number; second: number }> = {
	done: { gain: 0.12, first: G5, second: C5 },
	needsYou: { gain: 0.16, first: C5, second: G5 },
};

/** Overtones as [frequency multiple, relative gain]: a soft bell rather than a beep. */
const PARTIALS = [
	[1, 1],
	[2, 0.28],
	[3, 0.08],
] as const;

let context: AudioContext | undefined;

function ring(
	audio: AudioContext,
	frequency: number,
	start: number,
	duration: number,
	peak: number,
) {
	const end = start + duration;
	const envelope = new GainNode(audio);
	envelope.gain.setValueAtTime(0.0001, start);
	envelope.gain.linearRampToValueAtTime(peak, start + 0.008);
	envelope.gain.exponentialRampToValueAtTime(0.0001, end);
	envelope.connect(audio.destination);
	for (const [multiple, level] of PARTIALS) {
		const oscillator = new OscillatorNode(audio, { frequency: frequency * multiple });
		oscillator.connect(new GainNode(audio, { gain: level })).connect(envelope);
		oscillator.start(start);
		oscillator.stop(end + 0.02);
	}
}

/**
 * Synthesizes the cue with Web Audio, so there are no media files to ship.
 * Failures (no audio device, autoplay policy) are swallowed: a missed sound
 * must never surface as an error.
 */
export function playNotificationSound(cue: ChatCue): void {
	try {
		context ??= new AudioContext();
		const { gain, first, second } = CUES[cue];
		const at = context.currentTime + 0.01;
		ring(context, first, at, 0.3, gain);
		ring(context, second, at + 0.11, 0.45, gain);
	} catch {
		// Audio is best-effort.
	}
}
