# Play-by-Play API — Data Inventory & Coaching Opportunities

*Research only — no implementation planned yet.*
*Source: `https://www.superettanherr.se/api/gameday/play-by-play/otr8i7rhif` (96 events, Q4 of Fryshuset 111 – Huddinge 104)*

---

## Complete Event Type Catalogue

Every event has `realWorldTime` → every type below can be synced to video.

### All type / subType combinations

| type | subType values | Currently stored? | Currently in filters/labels? |
|------|---------------|-------------------|------------------------------|
| `2pt` | `layup`, `jumpshot` | ✅ | ⚠️ subType ignored — label is just "2PT Made/Miss" |
| `3pt` | `jumpshot` | ✅ | ⚠️ subType ignored |
| `freethrow` | `1of1`, `1of2`, `2of2` | ✅ | ⚠️ subType ignored |
| `rebound` | `defensive`, `offensive`, `offensivedeadball` | ✅ | ⚠️ off/def shown in label but NOT in separate filters; `offensivedeadball` ignored |
| `foul` | `personal` | ✅ | ✅ |
| `foulon` | (none) | ✅ | ✅ |
| `steal` | (none) | ✅ | ✅ |
| `block` | (none) | ✅ | ✅ |
| `assist` | (none) | ✅ | ✅ |
| `turnover` | `24sec`, `badpass` `dribbling or similar` | ✅ | ⚠️ subType ignored — all turnovers show same label |
| `substitution` | `in`, `out` | ❌ filtered out | ❌ |
| `clock` | `start`, `stop` | ❌ filtered out | ❌ |
| `period` | `end` (and `start` at tipoff) | ❌ (tipoff time extracted but event dropped) | ❌ |
| `game` | `end` | ❌ filtered out | ❌ |

---

## Complete Qualifier Catalogue

`qualifiers` is a string array on every event. All confirmed values:

| Qualifier | Appears on | Meaning |
|-----------|-----------|---------|
| `"pointsinthepaint"` | `2pt` | Interior/paint field goal |
| `"2ndchance"` | `2pt`, `freethrow` | Scoring after an offensive rebound |
| `"blocked"` | `3pt` | Shot attempt was blocked (on the shooter's event) |
| `"2freethrow"` | `foul`, `freethrow` | Foul results in 2 FTs / this FT is part of a 2-FT set |
| `"fromturnover"` | `freethrow` | Technical or turnover-derived free throw |
| `"team"` | `rebound`, `turnover` | Team stat (no individual player credited) |
| `"personal"` | `foul` | Personal foul subtype confirmation |
| `"shooting"` | `foul` | Shooting foul (leads to free throws) |
| `"24sec"` | `turnover` | Shot clock violation (also appears as subType) |

---

## `coordinates: {x, y}` Field

Present on: **`2pt`, `3pt`, `turnover`** events (and likely `block` in some games).
X range: 4.87 – 99.41 | Y range: 28.08 – 97.29 (court dimensions in percentage or feet — needs calibration).

**Not stored in the DB at all.** Not in `PlayByPlayEvent` type. Free data being discarded on every import.

---

## What Each Unused Event Type Contains

### `substitution`
Full player data (`playerId`, `pno`, `firstName`, `familyName`, `teamNumber`), `subType: "in"/"out"`, `period`, `realWorldTime`. No team field on the event directly — team is derived from `player.teamNumber`.

```json
{
  "eventId": 790, "type": "substitution", "subType": "in", "period": 4,
  "player": { "playerId": 2034968, "pno": 14, "teamNumber": 1,
               "firstName": "Frank", "familyName": "Nasasa Karlsson" },
  "realWorldTime": "2026-03-21T17:51:28.000Z"
}
```

### `clock`
Only `eventId`, `type`, `subType: "start"/"stop"`, `period`, `time` (game clock), `gameState`, `isSuccessful`. No team info — cannot identify who called the stoppage.

```json
{
  "eventId": 806, "type": "clock", "subType": "stop",
  "period": 4, "time": "00:00:00", "gameState": "ongoing",
  "realWorldTime": "2026-03-21T17:58:01.000Z"
}
```

### `timeout` *(confirmed — eventId 671 in this game)*
Has `eventTeam` (which team called it), `subType: "full"` (likely also `"20sec"` for short timeouts), `realWorldTime`, `period`, game clock `time`. No player field.

```json
{
  "eventId": 671, "type": "timeout", "subType": "full", "period": 4,
  "time": "05:17:00", "realWorldTime": "2026-03-21T17:38:03.000Z",
  "eventTeam": { "teamName": "Huddinge Basket", "teamNumber": 2, "place": "away" }
}
```

**Post-timeout sequence pattern** (confirmed from this data):
`timeout` (17:38:03) → `clock/start` (17:39:45) → first action (2pt at 17:40:06)

The `clock/start` event immediately after a timeout is the exact moment the ball is live again. Using the `timeout` event's `realWorldTime` as the clip anchor gives the full huddle + inbound in the pre-roll.

### `period`
Contains `eventId`, `type`, `subType: "end"` (or `"start"` at tipoff), `period`, `gameState`, `realWorldTime`. No player or team data.

---

## Coaching Relevance Assessment

### What coaches can already clip (currently)
2PT made/miss, 3PT made/miss, FT made/miss, rebound, steal, turnover, assist, foul, block.

### What the data enables that we're not exposing yet

**High coaching value — data already stored (just filter/label work):**
- **Layup vs jump shot** — 2pt subType `layup`/`jumpshot`: coaches study finishing efficiency near the rim separately from mid-range
- **Offensive vs defensive rebounds as separate filters** — currently lumped together in the filter list
- **Dead ball rebound / inbound plays** (`offensivedeadball`) — the offensive team retains possession and will inbound the ball (SOB or BOB set play). Coaches heavily study inbound situations. We cannot distinguish baseline from sideline from this field alone, but filtering on `rebound/offensivedeadball` already isolates every inbound-play opportunity. If `coordinates` were stored on the preceding shot/event, baseline vs sideline could potentially be inferred from the y-value (near 0 or 100 = baseline, mid-range y = sideline) — but this would require additional logic
- **Shot clock violations** — turnover subType `24sec`: coaches track which lineups struggle with shot clock discipline
- **Paint scoring** — qualifier `"pointsinthepaint"`: direct measure of interior attack success
- **Second-chance points** — qualifier `"2ndchance"`: offensive rebounding impact on scoring
- **Shooting foul** — qualifier `"shooting"` on foul: identifies which players are drawing FTs vs non-shooting fouls
- **FT sequence context** — freethrow subType `1of2`/`2of2`/`1of1`: coaches can isolate front-end misses in bonus situations

**Medium coaching value — requires storing new event types:**
- **Post-timeout clips** — `timeout` events have `eventTeam` (who called it) + `subType: "full"/"20sec"`. Using the timeout's `realWorldTime` as the clip anchor, the pre-roll shows the huddle and the post-roll shows the inbound play. Coaches can filter "our timeouts" vs "opponent timeouts"
- **Post-substitution plays** — storing `substitution` events (full player data) lets a coach mark the exact moment a lineup changes and clip the possessions that follow

**Lower coaching value / architectural cost:**
- **Shot chart** — `coordinates: {x, y}` are present on 2pt, 3pt, turnover events and fully discarded at import time. Storing them now costs nothing and unlocks a shot chart later
- **Tracking by lineup** — requires substitution events + post-processing to determine who was on the floor for each event

### Also discovered: additional raw fields not currently stored

Every event in the raw API response also contains fields we currently discard:
- `homeTeam.score` / `awayTeam.score` at the moment of the event — could enable **clutch filtering** (e.g. "show me all plays when the game was within 5 points")
- `periodType: "REGULAR"` — would become `"OVERTIME"` for OT periods
- `eventUuid` — stable UUID for each event (vs `eventId` which is sequential)
- `updatedTime` — last update timestamp (useful for live/streaming scenarios)

### What the data does NOT contain
- ❌ Baseline vs sideline out-of-bounds (no OOB event type exists)
- ❌ Play call or set name
- ❌ Pick-and-roll / screen involvement
- ❌ Defensive assignment (who was guarding whom)

---

## Summary: The Biggest Untapped Wins

| Opportunity | Data needed | Work required |
|-------------|------------|---------------|
| Layup / jump shot filter | Already stored (subType) | Filter + label only |
| Separate off/def rebound filters | Already stored (subType) | Filter only |
| Inbound plays (SOB/BOB) | Already stored (`offensivedeadball` subType) | Filter only |
| 2nd chance & paint filters | Already stored (qualifiers) | Filter only |
| Shot clock violation label | Already stored (subType) | Label only |
| Shooting foul filter | Already stored (qualifiers) | Filter only |
| **Post-timeout clips** | `timeout` events (not stored) — has team + subType | Add to ACTIONABLE_TYPES + label |
| Lineup-change clips | `substitution` events (not stored) — has player | Add to ACTIONABLE_TYPES + label |
| Clutch-moment filtering | `homeTeam.score`/`awayTeam.score` (not stored) | Add score columns to DB |
| Shot chart (future) | `coordinates` (not stored) | Add coordinate columns to DB |
