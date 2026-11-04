import { Back } from '../components/Shell';

export function AboutPage() {
  return (
    <>
      <Back />
      <h1>How the numbers work</h1>
      <div className="grid" style={{ maxWidth: 760 }}>
        <div className="panel">
          <h3>The rating</h3>
          <p>Every team gets one number: how many points it would beat an average Division I team by, on a neutral court, in a typical game. A +12 team is a 12-point favorite over an average team. A −5 team is a 5-point underdog. Teams are ranked by this number.</p>
          <p>It's built from two halves. <b>Offense</b> is the points a team would score per game against an average defense. <b>Defense</b> is the points it would allow against an average offense. Rating is offense minus defense.</p>
        </div>
        <div className="panel">
          <h3>Why "adjusted" matters</h3>
          <p>Scoring 80 against a terrible defense isn't the same as scoring 80 against a great one. So every game is weighed by the opponent: each team's offense is graded against the defenses it faced, and each defense against the offenses it faced. That's repeated until every team's numbers are consistent with every game it played.</p>
          <p>Home court is worth about two points per game to the home team, and that's taken out too. Beating a good team on the road is the most impressive thing you can do.</p>
        </div>
        <div className="panel">
          <h3>Early in a season</h3>
          <p>One blowout in November tells you very little. Until a team has played about six games, its rating leans on where it finished last season, pulled halfway back toward average to account for roster turnover. That pull fades as real games pile up. By January it's all this season.</p>
        </div>
        <div className="panel">
          <h3>Win chances and predicted scores</h3>
          <p>A matchup takes both teams' offense, defense, and pace and produces an expected score. The win chance comes from how far that expected margin is from zero, compared with how much real games swing: about 11 points in basketball, 15 in football, 4 runs in baseball.</p>
          <p>Tournament odds play out every remaining game 1,000 times with those win chances, then pick a 68-team field each time the way a committee roughly does: one automatic bid per conference, then the best remaining résumés. The percentage is how often a team made it.</p>
        </div>
        <div className="panel">
          <h3>Where the data comes from</h3>
          <p>Basketball and football box scores, play-by-play, and rosters come from ESPN's public game data. Baseball and softball come from the NCAA's official scoring system via NCAA.com, which carries every Division I game. Everything refreshes every three hours during the season.</p>
          <p>Games against non-Division I opponents are shown on schedules but excluded from ratings, so a team can't pad its number against a Division II school.</p>
        </div>
        <div className="panel">
          <h3>Does it work?</h3>
          <p>Checked against last season with no knowledge of the tournament: the men's model had champion Michigan #1 and runner-up UConn in its top ten; the women's model had both finalists, UCLA and South Carolina, in its top three.</p>
          <p className="muted sm" style={{ margin: 0 }}>The Advanced view on the ratings page shows the same numbers per 100 possessions (per 10 drives in football, per 9 innings in baseball), which is how analysts compare teams that play at different speeds. Same ratings, different scale.</p>
        </div>
      </div>
    </>
  );
}
