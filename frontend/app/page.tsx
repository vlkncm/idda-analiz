import Link from "next/link";
import { PredictionCard } from "../components/PredictionCard";
import { getPredictions } from "../lib/api";

const leagues = [
  ["", "Tümü"], ["TR-SL", "Türkiye"], ["EN-PL", "İngiltere"],
  ["FR-L1", "Fransa"], ["IT-SA", "İtalya"], ["DE-BL", "Almanya"],
];

export default async function Home({ searchParams }: { searchParams: Promise<{ league?: string }> }) {
  const { league = "" } = await searchParams;
  const predictions = await getPredictions(league || undefined);
  return (
    <main>
      <section className="hero"><p>VERİ ODAKLI · KALİBRE EDİLMİŞ</p><h1>Maçları değil,<br /><em>olasılıkları</em> okuyun.</h1><span>1/X/2 ve 2.5 ÜST tahminleri; Elo, Dixon-Coles ve makine öğrenmesi birlikte değerlendirilerek üretilir.</span></section>
      <div className="league-tabs">{leagues.map(([code, name]) => <Link className={league === code ? "active" : ""} href={code ? `/?league=${code}` : "/"} key={name}>{name}</Link>)}</div>
      <section className="grid">{predictions.length ? predictions.map(item => <PredictionCard key={`${item.match_id}-${item.model_version_id}`} prediction={item} />) : <div className="empty">Bu filtre için henüz maç öncesi tahmin bulunmuyor.</div>}</section>
    </main>
  );
}

