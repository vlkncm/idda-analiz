import type { Prediction } from "../lib/api";
import Link from "next/link";

const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

export function PredictionCard({ prediction }: { prediction: Prediction }) {
  const outcomes = [["1", prediction["1"]], ["X", prediction.X], ["2", prediction["2"]]] as const;
  const maximum = Math.max(...outcomes.map(([, value]) => value));
  return (
    <Link href={`/matches/${prediction.match_id}`} className="card-link"><article className="match-card">
      <div className="kickoff">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(prediction.kickoff_at))}</div>
      <h2><span>{prediction.home_team}</span><b>—</b><span>{prediction.away_team}</span></h2>
      <div className="markets">
        {outcomes.map(([label, value]) => <div className={value === maximum ? "market favorite" : "market"} key={label}><small>{label}</small><strong>{percentage(value)}</strong></div>)}
        <div className="market over"><small>2.5 ÜST</small><strong>{percentage(prediction.over25)}</strong></div>
      </div>
      <footer><span className={`confidence ${prediction.confidence.toLowerCase().replace("_", "-")}`}>{prediction.confidence}</span><span>Kesin sonuç değildir</span></footer>
    </article></Link>
  );
}
