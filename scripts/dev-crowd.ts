// `npm run dev:crowd`: fills a claimed Competition with fake Contestants and fake phones, so the
// Audience layer can be tried from one browser.
//
//   npm run dev:demo                      # once, with `npm run worker:dev` running
//   npm run dev:crowd -- dist/demo/<folder>/demo.citd-competition.json [--contestants N] [--phones M]
//                        [--round <name|id>] [--stale K] [--allow-remote]
//
// The Join code, Contestant token and Worker URL come from the Competition file; WORKER_URL
// overrides the Worker URL. The fake Contestants join the Round's Roster; the fake phones react
// while the phase allows it and vote once in each voting phase. The Host console drives it all.
// Ctrl-C closes every socket, so the fakes go offline.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompetitionFile, workerOrigin, type Competition, type Round } from "../src/pages/prep/competition.ts";
import {
  CLOSE_TOKEN,
  CLOSE_UNCLAIMED,
  CLOSE_VERSION,
  PING,
  REACTION_PHASES,
  socketPath,
  V,
  type Phase,
  type PublicSnapshot,
  type Role,
  type ServerMessage,
} from "../src/protocol/protocol.ts";
import { crowdRevisions, crowdRound, fakeName, parseCrowdArgs, pickReaction, pickVote, seatOf, voterOf } from "./crowd.ts";
import { refusal } from "./worker-url.ts";

/** A failure the script explains in one line, without a stack trace. */
export class CrowdError extends Error {}

/** How long, in ms, between one phone's Reactions and before its Vote: a random time in each range. */
export interface Timing {
  reactEvery: [number, number];
  voteAfter: [number, number];
}

const TIMING: Timing = { reactEvery: [1_500, 6_000], voteAfter: [1_000, 6_000] };
const PING_EVERY = 25_000;
const RECONNECT_AFTER = 1_000;
/** How long `stop()` waits for the Worker to close each socket. */
const CLOSE_WITHIN = 2_000;

export interface CrowdStats {
  /** Fake Contestants connected now, of `contestants`. */
  online: number;
  contestants: number;
  phones: number;
  /** The Current Round's phase, as the phones last saw it. */
  phase: Phase | null;
  reactions: number;
  votes: number;
}

export interface CrowdOptions {
  competition: Competition;
  round: Round;
  contestants: number;
  phones: number;
  stale: number;
  /** The Worker's origin. */
  workerUrl: string;
  random?: () => number;
  timing?: Timing;
  /** Called whenever the stats change. */
  onChange?(stats: CrowdStats): void;
}

export interface Crowd {
  stats: CrowdStats;
  /** Resolves if the Worker turns the crowd away: everything is closed by then. Never rejects. */
  failure: Promise<CrowdError>;
  /** Closes every socket and waits until the Worker has seen them close. */
  stop(): Promise<void>;
}

interface Handlers {
  open(): void;
  message?(message: ServerMessage): void;
  /** The socket closed with `code`, after it had opened. It reconnects unless the crowd is stopping. */
  down?(code: number): void;
}

/** Connects fakes to the Round and keeps them there until `stop()`. Rejects if the Worker can't be
 * reached at all. */
export async function runCrowd(options: CrowdOptions): Promise<Crowd> {
  const { competition, round, workerUrl } = options;
  const { joinCode, contestantToken } = competition.audience;
  const random = options.random ?? Math.random;
  const timing = options.timing ?? TIMING;
  const between = ([min, max]: [number, number]) => min + random() * (max - min);
  const stats: CrowdStats = {
    online: 0,
    contestants: options.contestants,
    phones: options.phones,
    phase: null,
    reactions: 0,
    votes: 0,
  };
  const changed = () => options.onChange?.({ ...stats });

  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) run();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const closers: (() => Promise<void>)[] = [];
  const stop = async () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    await Promise.all(closers.map((close) => close()));
  };
  let fail!: (error: CrowdError) => void;
  const failure = new Promise<CrowdError>((resolve) => {
    fail = (error) => {
      if (stopped) return;
      void stop().then(() => resolve(error));
    };
  });
  const unclaimed = () =>
    new CrowdError(
      `${joinCode} isn't claimed on ${workerUrl}: claim it from the Host console link in prep, or make a claimed one with \`npm run dev:demo\`.`,
    );

  /** A socket that reconnects whenever it drops, until the crowd stops. `opened` resolves once it
   * first opens, and rejects if it never does. */
  function keepOpen(role: Role, on: Handlers): { send(message: object): boolean; opened: Promise<void> } {
    const url = new URL(socketPath(joinCode, role), workerUrl.replace(/^http/, "ws"));
    let socket: WebSocket | undefined;
    let closed: Promise<void> = Promise.resolve();
    const send = (message: object) => {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ v: V, ...message }));
      return true;
    };
    closers.push(async () => {
      if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) socket.close();
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, CLOSE_WITHIN))]);
    });
    const opened = new Promise<void>((resolve, reject) => {
      let first = true;
      const connect = () => {
        const ws = (socket = new WebSocket(url));
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        closed = new Promise((resolve) =>
          ws.addEventListener("close", (event) => {
            clearInterval(heartbeat);
            resolve();
            if (first) return reject(new CrowdError(`Couldn't reach the Worker at ${workerUrl}: is \`npm run worker:dev\` running?`));
            on.down?.(event.code);
            if (event.code === CLOSE_VERSION) return fail(new CrowdError("The Worker doesn't speak this protocol version: update it."));
            if (!stopped) later(RECONNECT_AFTER, connect);
          }),
        );
        ws.addEventListener("open", () => {
          first = false;
          heartbeat = setInterval(() => ws.send(PING), PING_EVERY);
          on.open();
          resolve();
        });
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          if (message.t !== "pong") on.message?.(message);
        });
      };
      connect();
    });
    return { send, opened };
  }

  function contestant(i: number, revision: string) {
    let online = false;
    const presence = { token: contestantToken, roundId: round.id, seat: seatOf(joinCode, round.id, i), name: fakeName(i), revision };
    const socket = keepOpen("contestant", {
      open() {
        online = true;
        stats.online++;
        changed();
        socket.send({ t: "presence", ...presence });
      },
      down(code) {
        if (online) stats.online--;
        online = false;
        changed();
        if (code === CLOSE_UNCLAIMED) fail(unclaimed());
        if (code === CLOSE_TOKEN) {
          fail(new CrowdError(`The Worker refused the Contestant token for ${joinCode}: is this the Competition file that was claimed?`));
        }
      },
    });
    return socket.opened;
  }

  function phone(i: number) {
    let snapshot: PublicSnapshot | null = null;
    /** Where this phone's Vote in the current voting phase is: "counted" once a snapshot shows it. */
    let vote: "none" | "waiting" | "sent" | "counted" = "none";
    const cast = () => {
      // Counted after all: a reconnect, or voting reopened, brought this phone's Vote back.
      if (vote !== "waiting") return;
      const seat = snapshot?.lifecycle.phase === "voting" ? pickVote(snapshot.roster, random) : null;
      if (seat && socket.send({ t: "vote", seat })) {
        vote = "sent";
        stats.votes++;
        changed();
      } else {
        // An empty Roster, or the socket was down: the next snapshot tries again.
        vote = "none";
      }
    };
    const react = () => {
      const phase = snapshot?.lifecycle.phase;
      const reaction = phase && REACTION_PHASES.includes(phase) ? pickReaction(snapshot!.roster, random) : null;
      if (reaction && socket.send({ t: "react", ...reaction })) {
        stats.reactions++;
        changed();
      }
      later(between(timing.reactEvery), react);
    };
    const socket = keepOpen("phone", {
      open: () => socket.send({ t: "follow", voter: voterOf(joinCode, i) }),
      message(message) {
        if (message.t === "unclaimed") return fail(unclaimed());
        if (message.t !== "public") return;
        snapshot = message;
        const { phase } = message.lifecycle;
        if (stats.phase !== phase) {
          stats.phase = phase;
          changed();
        }
        if (phase !== "voting") vote = "none";
        else if (message.vote) vote = "counted";
        // Discarded with its entry: the phone picks again. A Vote merely sent may not show yet.
        else if (vote === "counted") vote = "none";
        if (phase === "voting" && vote === "none") {
          vote = "waiting";
          later(between(timing.voteAfter), cast);
        }
      },
    });
    later(between(timing.reactEvery), react);
    return socket.opened;
  }

  const revisions = crowdRevisions(round, options.contestants, options.stale);
  try {
    await Promise.all([
      ...revisions.map((revision, i) => contestant(i, revision)),
      ...Array.from({ length: options.phones }, (_, i) => phone(i)),
    ]);
  } catch (error) {
    // A socket that was still connecting when the Worker turned the crowd away.
    if (stopped) return { stats, failure, stop };
    await stop();
    throw error;
  }
  return { stats, failure, stop };
}

/** One line of the running summary. */
export const summary = (round: Round, stats: CrowdStats) =>
  [
    `${round.name}: ${stats.online}/${stats.contestants} fake Contestants online`,
    `${stats.phones} phones`,
    stats.phase ?? "no Current Round",
    `${stats.reactions} Reactions`,
    `${stats.votes} votes`,
  ].join(" · ");

function readCompetition(file: string): Competition {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new CrowdError(`Can't read ${file}.`);
  }
  const competition = parseCompetitionFile(text);
  if (!competition) throw new CrowdError(`${file} isn't a Competition file.`);
  if (!competition.audience.enabled) throw new CrowdError(`${file} has the Audience layer off: turn it on in prep.`);
  return competition;
}

async function main() {
  const args = parseCrowdArgs(process.argv.slice(2));
  if ("problem" in args) throw new CrowdError(args.problem);
  const competition = readCompetition(args.file);
  const workerUrl = process.env.WORKER_URL || competition.audience.workerUrl;
  const why = refusal(workerUrl, args.allowRemote);
  if (why) throw new CrowdError(why);
  const round = crowdRound(competition, args.round);
  if ("problem" in round) throw new CrowdError(round.problem);

  const tty = process.stdout.isTTY;
  let last = "";
  const show = (stats: CrowdStats) => {
    const line = summary(round, stats);
    if (line === last) return;
    last = line;
    if (tty) process.stdout.write(`\r\x1b[2K${line}`);
  };
  const { contestants, phones, stale } = args;
  const crowd = await runCrowd({
    competition,
    round,
    contestants,
    phones,
    stale,
    workerUrl: workerOrigin(workerUrl)!,
    onChange: show,
  });
  console.log(`Crowding ${round.name} of "${competition.name}" (${competition.audience.joinCode}). Ctrl-C to stop.`);
  show(crowd.stats);
  // Without a TTY the line can't be rewritten in place, so it's printed now and then instead.
  const log = tty ? undefined : setInterval(() => console.log(summary(round, crowd.stats)), 5_000);

  const interrupted = new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  const failed = await Promise.race([crowd.failure, interrupted]);
  clearInterval(log);
  if (tty) process.stdout.write("\n");
  if (failed) throw failed;
  await crowd.stop();
  console.log(`Stopped: ${summary(round, crowd.stats)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    if (!(error instanceof CrowdError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
