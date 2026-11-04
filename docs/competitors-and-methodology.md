# Where we stand: competitors, methodology, and what's actually better

Working name: Ratings Lab. November 4, 2026.

This is written to be honest, not to be a pitch. Where someone else is better, it says so.

---

## 1. Who we're up against

### Men's basketball ratings (the crowded lane)

| Site | What it is | Price | Where it beats us today | Where we beat it |
|---|---|---|---|---|
| **KenPom** (kenpom.com) | The standard. Adjusted efficiency ratings since 2002. Every coach, every broadcast, the selection committee. | $24.95/yr; $95 API | 20 years of trust and calibration. Four Factors, player stats, game "FanMatch" predictions. | Men's basketball only. Dense tables, no phone experience, no shot charts, no transfer tracking, no tournament simulator, no community features. |
| **Bart Torvik** (barttorvik.com) | Free KenPom alternative with date filters and a player value stat. Also covers women's basketball. | Free | Date-range filtering, more player stats, open methodology. | One-man hobby site with a 2010 interface. Nothing visual, nothing for fans, no app. |
| **EvanMiya** | Newer analytics site with a "Front Office Suite" sold to ~30 basketball programs. | Freemium | Player-level ratings (BPR). | Men's basketball only, newer and less proven. |
| **Haslametrics** | Free ratings with some fun extras. | Free | Unusual stats. | Niche; no design, no breadth. |
| **Hoops HQ** (Seth Davis) | Paywalled editorial on men's and women's basketball. | Subscription | Writing, access, reporting. | It's journalism, not data. They'd be a customer for our numbers, not a competitor. |
| **ShootyHoops** | Editorial previews, bracketology, roster tracker, community ballots. | Free | Beautiful conference previews, written by humans. | Writing doesn't scale to six sports. No ratings engine behind it, no player pages, no odds. |

### Women's basketball

| Site | Notes |
|---|---|
| **Her Hoop Stats** | $50/yr. The only real women's analytics site. Its outage in 2023 took the entire sport's analytics offline for days. |
| **Torvik** | Has a women's section; same dated interface. |
| **Sports Reference** | Historical stats only, added women's hoops in 2024. No ratings or predictions. |

### Baseball and softball

| Site | Notes |
|---|---|
| **D1Baseball / D1Softball** | $189.99/yr for the top tier. Journalism, rankings polls, transfer scoops, a picks product. No adjusted ratings; their "PreD1ctive Picks" is a black box. |
| **Warren Nolan** | Free RPI and records across sports. Looks like 2009. No efficiency ratings, no predictions, no player data. |
| **6-4-3 Charts** | Sells scouting data to 500+ programs. Not a fan product. |

### Football

| Site | Notes |
|---|---|
| **ESPN FPI / SP+ (Bill Connelly)** | The established models, behind ESPN's paywall. Excellent. |
| **CollegeFootballData** | A data API for people who build models, funded on Patreon. Not a fan site. |

### The one-line summary

Every competitor is **one sport**, and most are **one person**. Nobody has one clean product covering men's and women's basketball, baseball, softball, and football with the same ratings method, the same pages, and the same odds. That is the whole bet.

---

## 2. Where our numbers come from

**Basketball and football:** ESPN's public game data. For every game we pull the schedule and score, both teams' box score, every player's line, the play-by-play (with shot locations in basketball and drive logs in football), and the official roster (height, weight, class, hometown). This is the same feed ESPN's own app reads.

**Baseball and softball:** the NCAA's official scoring system, through NCAA.com. ESPN only carries about half of college baseball and no box scores, so we went to the source. Every Division I game, inning-by-inning line scores, full batting and pitching boxes.

**Conference membership** comes from each sport's official standings, by season, so realignment history is right.

**Refresh:** every three hours during the season, automatically. Anything a run misses, the next one picks up. We cache every raw response so parsers can be rerun without re-downloading.

**What we don't have:** anything licensed. No official NCAA betting feed (Genius Sports owns that through 2032), no photos, no proprietary tracking data. Facts (scores, stats) aren't copyrightable; logos and likenesses are, which is why the product is text-and-color first.

---

## 3. How the ratings are built

The method is the one KenPom made standard. We didn't invent it; we generalized it so one engine rates every sport.

**Step 1: efficiency, not points.** Points per game depends on pace. A team that plays fast scores more without being better. So each team-game is measured per scoring unit: per 100 possessions in basketball (possessions estimated from shots, rebounds, turnovers, and free throws, the same formula KenPom uses), per 10 drives in football (from the drive log, with end-of-half kneel-downs removed), per 9 or 7 innings in baseball and softball.

**Step 2: adjust for the opponent.** A team's offensive rating is its average efficiency scaled by how good each opponent's defense was. Its defensive rating is scaled by each opponent's offense. Those depend on each other, so it iterates, up to 60 passes, until nothing moves. After every pass the averages are re-centered so "100" always means "average," which stops the numbers from drifting (we caught and fixed exactly that drift in softball).

**Step 3: adjust for venue.** Home advantage is estimated from the data itself, from the leftover margin in home games after both teams' strength is accounted for. It starts at a prior (about 2 points per 100 possessions in hoops) and the real estimate takes over once there are enough road games. Last season it converged to 2.4 in men's basketball, 2.3 in women's.

**Step 4: don't overreact early.** Until a team has about six games, its rating is blended with where it finished last season, pulled halfway back toward average for roster turnover. By January that prior is gone. (Football has no prior yet because 2026 is its first season in the system; that's why its November rankings are noisier.)

**Step 5: only count real games.** Games against non-Division I opponents are kept on schedules but excluded from ratings. In baseball and softball, run-rule games count as a full game, so a 10-run win in 5 innings isn't inflated to 14.

**Rating = offense minus defense.** On the site it's shown per game (using the team's own pace), because "beats an average team by 12" is something anyone understands. The Advanced toggle shows the per-100 version analysts use. Same number, different scale.

### Win chances and projections
Expected score = each team's offense against the other's defense at the combined pace, plus home edge. Win chance = how far that margin sits from zero, against how much real results scatter (about 11 points in basketball, 15 in football, 4 runs in baseball). Projected records sum those chances over the remaining schedule. Tournament odds replay the season 1,000 times and pick a 68-team field each time (one auto-bid per conference, then the best résumés).

### Does it hold up?
Checked on 2025-26 with no knowledge of the postseason:
- Men: Michigan #1 (won the title), Duke #2 (deep run), UConn #10 (runner-up, 40 games played).
- Women: UCLA #2 and South Carolina #3 were the two finalists; UConn #1 had the nation's best defense.
- League averages (108.5 points per 100 possessions, ~68 possessions a game) match KenPom's published figures.

What it hasn't been tested on: a full football season, a full baseball/softball season, and head-to-head accuracy against Vegas lines. Those are the next validations, and they should happen before anything is sold as "predictive."

---

## 4. What makes this better, honestly

**It is better at:**
1. **Breadth with one method.** Five sports, both genders, one engine, one set of pages, one app. No one else has this.
2. **Women's and non-revenue sports treated as first-class.** Women's basketball, softball, and baseball get the same ratings, odds, player pages, and leaderboards as men's hoops. In softball, nothing like it exists at all.
3. **Built for a phone.** Every competitor is a desktop table. This is designed for the device fans actually check during a game, and installs like an app.
4. **Numbers for people.** Headline figures are per game in plain words, with a key one tap away. The analyst scale is there, but it's not the front door.
5. **Things to do, not just read.** The matchup machine, the tournament simulator, the ballot that scores you against the model, shot charts, game-flow charts, the transfer tracker. KenPom is a reference; this is something you use.
6. **Player pages across sports**, with game logs, shot charts, career paths, and transfers linked end to end.
7. **It runs itself.** Refreshes every three hours, heals gaps, re-rates the archive when the model improves. One person can operate it.

**It is not (yet) better at:**
1. **Trust.** KenPom has 20 years of being right in public. We have one validated season. This gap only closes with time and a published track record.
2. **Depth in men's basketball.** KenPom's Four Factors, luck, and schedule-strength breakdowns are more complete. Ours are planned, not built.
3. **Writing.** ShootyHoops and D1Baseball have human previews and scoops. We have numbers. That's a choice, but it's a gap for fans who want narrative.
4. **Football.** One season, no prior, drive data only. It's credible, not authoritative.
5. **Photos and identity.** No headshots until there's a licensing or athlete-claimed path.

---

## 5. The pitch in one paragraph

Every serious college ratings site covers one sport, was built by one person a decade ago, and looks like it. This is one engine, one design, and one app for men's and women's basketball, baseball, softball, and football, with the same opponent-adjusted method KenPom made the standard, shown in numbers a normal fan can read, with odds, matchups, player pages, transfers, and leaderboards that nobody else has in one place. It validated on last season's champions in both basketballs, refreshes itself every three hours, and runs for the price of one database.
