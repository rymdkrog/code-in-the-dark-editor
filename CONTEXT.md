# Code in the Dark Editor

The editor contestants use in a Code in the Dark competition — recreating a reference web page from a screenshot, in a fixed time, without ever seeing a preview — plus optional companions for organizers and the audience.

## Language

### People

**Contestant**:
A person competing in a round, writing HTML/CSS blind in the Core Editor.
_Avoid_: Participant, player, competitor

**Organizer**:
A person who prepares a Competition: its Rounds, References and assets.
_Avoid_: Admin

**Host**:
The person running a Competition live: starting Rounds, running the timer, opening voting. Usually an Organizer wearing a different hat.
_Avoid_: MC, admin, moderator

**Audience**:
The people watching a competition, who see Contestants' screens but never their result before the Reveal.
_Avoid_: Spectators, viewers

### The game

**Competition**:
One event, made of several Heats and a Final.
_Avoid_: Event, tournament

**Round**:
One timed challenge in which Contestants recreate the same Reference. Every Heat and the Final is a Round.
_Avoid_: Challenge, match

**Heat**:
A qualifying Round; each Heat has its own Reference.

**Final**:
The last Round of a Competition, contested by Heat winners, with its own Reference.

**Current Round**:
The one Round the Host has put in front of the Audience; only one Round is current at a time.

**Roster**:
The Contestants taking part in a Round, as the Host and Audience see them. Contestants still looking at an earlier Round's work are not on the current Round's Roster.
_Avoid_: Lineup, participants

**Reference**:
The screenshot of the target page Contestants must recreate.
_Avoid_: Target, page.png, design

**Reveal**:
The moment a Contestant's code is rendered for the first time, at the end of a Round.
_Avoid_: Finish, result, preview

**Combo**:
The running count of a Contestant's consecutive insertions, reset after a pause.
_Avoid_: Streak, score

**Power Mode**:
The heightened visual state (particles, shake, colour shift) a Contestant enters once their Combo passes a threshold.

### The system

**Core Editor**:
The editor a Contestant competes in — the same for every Round; it works fully offline and never depends on anything else.
_Avoid_: App, client

**Round package**:
The single self-contained file built for one Round — the Core Editor plus that Round's Reference, assets, instructions and connection details. It is what a Contestant opens.
_Avoid_: Bundle, round file

**Revision**:
One export of a Round package. Re-exporting keeps the same Round but makes a new Revision.
_Avoid_: Version, build

**Competition file**:
The Organizer's saved definition of a Competition — its Rounds, their References, assets and colours, and its credentials — exported and reopened by the prep page. It holds the Host secret, so it is never handed to Contestants.
_Avoid_: Project, save file, config

**Enhancement**:
Any capability layered on top of the Core Editor (preparation tooling, audience participation) whose absence or failure the Contestant never notices.
_Avoid_: Plugin, add-on, online mode

**Stage**:
The separate screen at the venue showing shared Competition state — the timer, voting — rather than any one Contestant's editor.
_Avoid_: Projector view, dashboard, scoreboard

**Join code**:
The short public code the Audience uses to join a Competition; one code covers every Round of the Competition.
_Avoid_: Session code, PIN, room
