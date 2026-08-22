def explain_prediction(features: dict[str, float], model_probabilities: dict[str, tuple[float, float, float]], limit: int = 4) -> list[str]:
    """Create deterministic explanations only from supplied model features."""
    reasons: list[tuple[float, str]] = []
    elo = features.get("elo_difference")
    if elo is not None:
        side = "ev sahibi" if elo >= 0 else "deplasman"
        reasons.append((abs(elo) / 250, f"{side} Elo avantajı: {elo:+.0f}"))
    home_xg = features.get("home_form_10_xg")
    away_xga = features.get("away_form_10_xga")
    if home_xg and not features.get("home_form_10_xg_missing", 1):
        reasons.append((home_xg / 3, f"Ev sahibinin son 10 maç xG ortalaması: {home_xg:.2f}"))
    if away_xga and not features.get("away_form_10_xg_missing", 1):
        reasons.append((away_xga / 3, f"Deplasman takımının son 10 maç xGA ortalaması: {away_xga:.2f}"))
    winners = [max(range(3), key=probabilities.__getitem__) for probabilities in model_probabilities.values()]
    if winners and len(set(winners)) == 1:
        labels = ("1", "X", "2")
        reasons.append((1.0, f"Tüm alt modeller {labels[winners[0]]} sonucunu destekliyor"))
    return [text for _, text in sorted(reasons, reverse=True)[:limit]]

