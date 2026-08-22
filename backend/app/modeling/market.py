def remove_vig(*odds: float) -> tuple[float, ...]:
    if not odds or any(value <= 1 for value in odds):
        raise ValueError("decimal odds must be greater than 1")
    raw = [1 / value for value in odds]
    total = sum(raw)
    return tuple(value / total for value in raw)

