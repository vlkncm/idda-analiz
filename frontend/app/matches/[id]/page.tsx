import { notFound } from "next/navigation";
import { getMatch, getMatchPrediction } from "../../../lib/api";

const pct = (value: unknown) => `${(Number(value) * 100).toFixed(1)}%`;

export default async function MatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [match, prediction] = await Promise.all([getMatch(id), getMatchPrediction(id)]);
  if (!match) notFound();
  const features = (prediction?.feature_snapshot ?? {}) as Record<string, number>;
  const reasons = (prediction?.explanation ?? []) as string[];
  return <main><section className="hero compact"><p>MAÇ ANALİZİ</p><h1>{String(match.home_team)}<br /><em>{String(match.away_team)}</em></h1><span>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short" }).format(new Date(String(match.kickoff_at)))}</span></section>
    {prediction ? <><section className="detail-markets"><div><small>1</small><strong>{pct(prediction.home_probability)}</strong></div><div><small>X</small><strong>{pct(prediction.draw_probability)}</strong></div><div><small>2</small><strong>{pct(prediction.away_probability)}</strong></div><div><small>2.5 ÜST</small><strong>{pct(prediction.over25_probability)}</strong></div></section>
    <section className="admin-grid"><div className="panel"><h2>Confidence</h2><div className="confidence-big">{String(prediction.confidence)}</div><p>Model agreement: {pct(prediction.model_agreement)}</p><p>Bu değer kesin sonuç veya kazanç garantisi değildir.</p></div><div className="panel"><h2>Ana nedenler</h2><ul className="reasons">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div></section>
    <section className="panel"><h2>Maç öncesi feature özeti</h2><div className="feature-grid">{["home_elo", "away_elo", "elo_difference", "home_last5_points_per_game", "away_last5_points_per_game", "home_xg_avg", "away_xg_avg", "home_rest_days", "away_rest_days"].filter(key => key in features).map(key => <div key={key}><small>{key.replaceAll("_", " ")}</small><strong>{Number(features[key]).toFixed(2)}</strong></div>)}</div></section></> : <div className="empty">Bu maç için henüz production model tahmini oluşturulmadı.</div>}
  </main>;
}
