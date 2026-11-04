import { Back } from '../components/Shell';

export function AboutPage() {
  return (
    <>
      <Back />
      <h1>How the ratings work</h1>
      <div className="panel" style={{ maxWidth: 720 }}>
        <p>Every game gives each team two numbers: points scored per 100 possessions and points allowed per 100 possessions.</p>
        <p>A great offense against a bad defense should score a lot, so we adjust. Each team's offense is graded against the quality of the defenses it faced, and each defense against the offenses it faced, over and over until the numbers settle. Home court is worth about 2 points per 100 possessions to each side.</p>
        <p><b>Margin</b> is offense minus defense: how many points per 100 possessions a team beats an average Division I team by on a neutral floor.</p>
        <p>Early in the season every team is pulled toward average, because one blowout says very little. That pull fades as games pile up.</p>
        <p><b>Win chances</b> come from the expected score difference and how much real games vary around it, about 11 points.</p>
        <p className="muted">Checked against last season: the model's final top three on the men's side included the champion (Michigan, #1), and on the women's side both finalists (UCLA, South Carolina).</p>
      </div>
    </>
  );
}
