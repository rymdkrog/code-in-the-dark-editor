# PROTOTYPE — Audience phone page (throwaway)

Answers the Wayfinder ticket **What does the Audience phone page look like?** (#14). Not production code.

Double-click `audience-phone-prototype.html`. The phone is on the left and the venue simulator is on the right. Flip variants with ← / → or the lime bar. `?variant=A|B|C` is shareable.

**Variants**
- **A — Roster rows:** every Contestant is a row with their own emoji buttons, so there's no "pick first" step. The ballot is the same rows with a radio.
- **B — Pick, then pad:** Contestant chips along the top and a huge emoji pad in the thumb zone. Voting is its own screen, then a "You voted for Ada ✓ · Change my vote" confirmation.
- **C — Swipe cards:** one Contestant per full-screen card. You choose an emoji in the tray and tap anywhere on the card to send it. Voting is the same deck with a "Vote for Ada" button on each card.

The states outside reacting and voting are shared across variants: code entry, waiting for the code to open, welcome (no Current Round), results ("eyes on the Stage" plus your pick) and reconnecting.

Real: the phone states for every lifecycle phase, one vote per voter id (last one wins), turnout, a ballot that follows the live Roster (a removed entry discards its votes), the phone's coalescing of taps and the request maths from the Cloudflare research.
Fake: the Durable Object, the sockets, the other phones and the Contestant laptops. They're all in memory and driven by the simulator. The laptops are a stand-in, because how reactions look there is the reactions ticket's question.

## Choices the prototype had to make (react to these)

1. **No name, no account.** A phone is a random voter id and nothing else.
2. **The QR link carries the code** (`…/join?c=K7XQ2M`), so scanning it joins at once. Typing the bare URL opens code entry, which only accepts the 6-character alphabet.
3. **A wrong code looks the same as one that isn't open yet.** Any code reaches *some* Durable Object, so the phone can't tell a typo from an unclaimed Competition. It shows "Waiting for K7XQ2N to open… Not starting? Check the code on the Stage" and keeps retrying.
4. **Reactions are allowed while a Round is up next, running and at time's up** (the Reveals). They aren't allowed during voting or at results.
5. **Offline and hand-added Contestants are shown but can't be reacted to.** Hand-added entries are votable.
6. **A small clock is in the header** (A and B) while the Round is up next or running. It's not a Contestant-screen timer.
7. **The emoji set is fixed by the software:** 6 by default (🔥 👏 😂 😱 🤯 ❤️). The simulator lets you try 4 or 8.
8. **Taps are coalesced with a leading edge.** The first tap after a pause goes out at once, and the taps inside the window ride the next message as counts (`{"🔥":7}`). **A 250 ms window isn't enough.** If 300 phones send at its 4 msg/s cap for 75 minutes, that's ≈ 270,000 requests (over Free's 100,000/day) and a peak of 1,200 msg/s (over the ~1,000/s soft limit). **A 1 s window keeps even that worst case inside Free:** ≈ 67,500 requests and a peak of 300 msg/s. The cost is that a burst lands as a clump about once a second.
9. **The phone shows its own burst at the tap point immediately**, plus a tiny vibration on Android. The feedback never waits for the network.
