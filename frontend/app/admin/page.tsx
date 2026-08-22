import { getAdminCollection, getPerformance } from "../../lib/api";

export default async function AdminPage() {
  const [rows, versions, backtests, wrong, quality] = await Promise.all([getPerformance(), getAdminCollection("model-versions"), getAdminCollection("backtests"), getAdminCollection("wrong-predictions"), getAdminCollection("data-quality")]);
  const latest = rows[0] as { sample_size?: number; metrics?: Record<string, number>; feature_importance?: Record<string, number> } | undefined;
  const metrics = latest?.metrics ?? {};
  const importance = Object.entries(latest?.feature_importance ?? {}).slice(0, 10);
  return <main><section className="hero compact"><p>MODEL MONITORING</p><h1>Performans merkezi</h1><span>Walk-forward sonuçları, kalibrasyon ve feature importance kayıtları.</span></section>
    <section className="stats"><div><small>ÖRNEKLEM</small><strong>{latest?.sample_size ?? 0}</strong></div><div><small>MODEL SÜRÜMÜ</small><strong>{String(versions[0]?.version ?? "—")}</strong></div><div><small>BACKTEST</small><strong>{backtests.length}</strong></div><div><small>HATALI TAHMİN</small><strong>{wrong.length}</strong></div></section>
    <section className="admin-grid"><div className="panel"><h2>Kalite metrikleri</h2>{Object.entries(metrics).filter(([, value]) => typeof value === "number").map(([name, value]) => <div className="metric-row" key={name}><span>{name.replaceAll("_", " ")}</span><b>{Number(value).toFixed(4)}</b></div>)}</div>
    <div className="panel"><h2>Feature importance</h2>{importance.length ? importance.map(([name, value]) => <div className="importance" key={name}><span>{name}</span><i><b style={{ width: `${Math.min(100, Number(value) * 100)}%` }} /></i><em>{(Number(value) * 100).toFixed(1)}%</em></div>) : <div className="empty">Henüz feature importance kaydı yok.</div>}</div></section>
    <section className="panel"><h2>Veri kalitesi</h2><pre>{JSON.stringify(quality, null, 2)}</pre></section>
    <section className="panel"><h2>Son backtestler ve yanlış tahminler</h2><div className="code-grid"><pre>{JSON.stringify(backtests.slice(0, 5), null, 2)}</pre><pre>{JSON.stringify(wrong.slice(0, 10), null, 2)}</pre></div></section></main>;
}
