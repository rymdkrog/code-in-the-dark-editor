# PROTOTYPE — Stage and Host console (throwaway)

Answers the Wayfinder ticket **What do the Stage display and Host console look like?** (#13). Not production code.

Double-click `stage-host-prototype.html`. The Host console is on the left. The Stage (a 1920×1080 venue monitor, scaled down) is on the right, above a venue simulator.
Flip Host variants with ← / → and Stage variants with Shift+← / Shift+→, or use the lime bar. `?host=A|B|C&stage=A|B|C` is shareable. `?view=stage` shows the Stage on its own, and **⧉ pop out Stage window** opens it in a separate window you can drag to a second screen.

**Host console**
- **A — Control desk** (laptop): a rail of Rounds with their ready counts, and one Round at a time with a lifecycle stepper, the timer and controls, and a Roster table that gains the live tally while voting.
- **B — Remote** (phone): a Round picker, a huge clock, one big contextual button, and a collapsible Roster. Built for a Host standing on stage.
- **C — Rounds board** (laptop): every Round is a column of its Roster, so you see who is ready for which Round. A transport bar on top drives the Current Round.

**Stage**
- **A — Giant clock:** the timer fills the screen, with a small join corner. Voting shows a big QR and the turnout. Results show the whole ranking at once.
- **B — Join sidebar:** a permanent QR sidebar. Results are revealed **last-to-first**, with joint leaders arriving together.
- **C — Name tiles:** the Roster as tiles, with a draining time bar. Results grow as columns **in Roster order** (not sorted), and the leader is crowned.
- **D — Combined** (after first feedback): C's tiles, A's giant clock while running, and the **Reference** beside the turnout while voting.

Real: the lifecycle rules (upcoming → running → time's up → voting → results, reopen, re-run clears votes), the tally with ties, the stale-Revision flag, hand-added and removed entries, the claim screen, timers from an absolute `endsAt` (so they keep running while the Host or Stage is disconnected), and real QR codes (qrcode-generator, MIT, inlined).
Fake: the Durable Object, the sockets, the laptops and the phones. All of them are in memory and driven by the simulator. A reload resets to the seeded mid-event state.

## Choices the prototype had to make (react to these)

1. **Welcome screen = no Current Round.** The Host can clear the Stage back to the Competition name, Join code and QR. This is a new state: the session model only had "one Round is current".
2. **Duration is server state**, set while a Round is "up next" (default 15 min), so the Stage can show it before Start.
3. **"Stale" means older than the newest Revision seen for that Round.** The Host console never learns what was exported, because the link is copied once.
4. **Removing an entry whose laptop is still connected hides it for the rest of that Round.** Otherwise it would pop straight back.
5. **Re-run is "Back to up next", then Start.** Start confirms, then clears the old votes.
6. **Switching the Current Round mid-Round** asks first, and abandons the timer or skips voting.
7. **Add time works only while running.** After time's up there is no "un-end".
8. **The Host console pauses its controls while offline.** The server is authoritative, and nothing is queued.
9. **Turnout replaces the clock** on the Host console during voting and results.
