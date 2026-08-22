# Backend

Varsayılan SQLite/opsiyonel PostgreSQL, ücretsiz Football-Data.co.uk CSV sync,
feature engineering, walk-forward training, model artifact ve FastAPI katmanını
içerir. Tam kullanım rehberi kök README'dedir.

```powershell
cd backend
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
Copy-Item .env.example .env
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\pytest
.\.venv\Scripts\uvicorn app.main:app --reload
```

Python projesi 3.12 ve üstünü destekler. PostgreSQL bağlantısını `.env` içindeki
`DATABASE_URL` ile değiştirin. Parola ve API anahtarlarını repoya eklemeyin.

## Ücretsiz veri akışı

API anahtarı gerektirmeden:

```powershell
.\.venv\Scripts\python -m app.cli bootstrap
.\.venv\Scripts\python -m app.cli sync
.\.venv\Scripts\python -m app.cli train
.\.venv\Scripts\python -m app.cli backtest --league TR-SL
.\.venv\Scripts\python -m app.cli predict
.\.venv\Scripts\python -m app.cli status
```

Opsiyonel ücretsiz football-data.org desteği için `FOOTBALL_DATA_API_KEY`
tanımlanabilir. Sportmonks normal akışta zorunlu değildir.

Swagger: http://127.0.0.1:8000/docs

## Opsiyonel CSV veri yükleme

`examples/matches.csv` başlık sözleşmesini gösterir. Tarihler mutlaka saat dilimi
içermelidir:

```powershell
.\.venv\Scripts\python -m app.cli ingest-csv `
  --file examples/matches.csv --league TR-SL --season 2026-27 `
  --start-date 2026-08-01 --end-date 2027-05-31
```

## Hazır feature CSV'sinden model eğitimi

Feature pipeline çıktısı; `season`, `kickoff_at`, `result_target`,
`over25_target`, `dc_home/draw/away`, `elo_home/draw/away` ve sayısal feature
sütunlarını içeren bir CSV olmalıdır. Son sezon validation, önceki sezonlar
training olarak kullanılır:

```powershell
.\.venv\Scripts\python -m app.cli train `
  --file data/training-features.csv --league TR-SL --version v1.0
```

Artifact oluşmadan `/api/v1/matches/{match_id}/predict` tahmin üretmez. Bu,
eğitilmemiş veya hayali olasılıkların kullanıcıya sunulmasını engeller.
