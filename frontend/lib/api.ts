// This module is only imported by server components. Keeping the internal URL
// private prevents the Docker service hostname from being exposed to browsers.
export const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000/api/v1";

export type Prediction = {
  match_id: number;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  "1": number;
  "X": number;
  "2": number;
  over25: number;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  model_version_id: number;
};

export async function getPredictions(league?: string): Promise<Prediction[]> {
  const query = league ? `?league_code=${encodeURIComponent(league)}` : "";
  const response = await fetch(`${API_URL}/predictions${query}`, { cache: "no-store" });
  if (!response.ok) return [];
  return response.json();
}

export async function getPerformance(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${API_URL}/admin/performance`, { cache: "no-store" });
  if (!response.ok) return [];
  return response.json();
}

export async function getAdminCollection(path: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${API_URL}/admin/${path}`, { cache: "no-store" });
  return response.ok ? response.json() : [];
}

export async function getMatch(id: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${API_URL}/matches/${id}`, { cache: "no-store" });
  return response.ok ? response.json() : null;
}

export async function getMatchPrediction(id: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${API_URL}/matches/${id}/prediction`, { cache: "no-store" });
  return response.ok ? response.json() : null;
}
