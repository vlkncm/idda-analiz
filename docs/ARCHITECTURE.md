# Avrupa Futbol Tahmin Motoru Mimarisi

## Amaç ve sınırlar

İlk sürüm Türkiye Süper Lig, Premier League, Ligue 1, Serie A ve Bundesliga için
maç öncesi `P(1)`, `P(X)`, `P(2)` ve `P(2.5 ÜST)` üretir. Sonuçlar kesinlik
iddiası değil, kalibre edilmiş olasılıklardır. Yeni motor mevcut Node/Electron
uygulamasından ayrıştırılmıştır; `backend/` FastAPI ve modelleme katmanını,
ileride eklenecek `frontend/` ise Next.js istemcisini barındırır.

## Bileşenler

1. **Provider adapters:** CSV ve kullanım şartlarına uygun API'leri ortak
   `DataProvider` sözleşmesine dönüştürür.
2. **Ingestion:** Ham yanıtları doğrular, provider kimlikleriyle idempotent
   biçimde lig/takım/maç kayıtlarına upsert eder.
3. **Feature snapshots:** Yalnızca maçın `kickoff_at` anından önce bilinen
   verilerden özellik üretir ve `as_of` zamanı ile saklar.
4. **Model katmanı:** Lig bazlı Dixon-Coles, Elo ve kalibre edilmiş ML
   olasılıklarını bağımsız üretir.
5. **Ensemble:** Walk-forward validasyonda lig başına optimize edilmiş
   ağırlıklarla model çıktılarını birleştirir.
6. **Prediction ledger:** Tahmini maç başlamadan, model sürümüyle ve değişmez
   zaman damgasıyla saklar. Gerçekleşen sonuç ayrı alanlarda sonradan eklenir.
7. **API/UI:** FastAPI salt okunur tahmin ve yönetim uçlarını; Next.js mobil
   uyumlu kullanıcı ve yönetim ekranlarını sunar.

Bağımlılık yönü `api -> services -> domain/modeling -> repositories -> db`
şeklindedir. Provider kodu modelleme koduna, modelleme kodu HTTP katmanına
bağlanmaz.

## Veritabanı şeması

PHASE 1 çekirdek tabloları:

| Tablo | Amaç | Temel kısıtlar |
|---|---|---|
| `leagues` | Modüler lig kataloğu | `code` benzersiz |
| `seasons` | Lig sezonu ve tarih sınırları | lig + ad benzersiz |
| `teams` | Takım ana kaydı | `code` benzersiz |
| `team_seasons` | Takımın sezona katılımı | sezon + takım benzersiz |
| `matches` | Fikstür ve sonuç | provider + external id benzersiz; goller birlikte null/dolu |
| `model_versions` | Üretime alınabilir model sürümü | sürüm benzersiz |
| `predictions` | Maç öncesi değişmez olasılık kaydı | dört olasılık `[0,1]`; 1/X/2 toplamı 1 |

Sonraki migration'lar `team_match_stats`, `odds_snapshots`, `player_match_stats`,
`squad_availability`, `coach_tenures`, `feature_snapshots`, `elo_snapshots`,
`model_metrics` ve `backtest_runs` tablolarını ekleyecektir. Zaman alanları UTC
tutulur. Harici veri kaynağının kimliği korunarak aynı veri tekrar güvenle
alınabilir.

## Feature kataloğu

Tüm kayan pencereler maçtan hemen önce kesilir ve 5/10 maç için ayrı üretilir:

- güç: Elo, Elo farkı, sıra, maç başı puan ve gol farkı;
- form: G/B/M, atılan/yenen gol, puan/maç ve rakip Elo ağırlıklı form;
- saha ayrımı: ev/deplasman gol, xG, xGA ve sonuç oranları;
- gol: beklenen toplam gol, üst 2.5 oranları, takım/rakip hücum göstergeleri;
- fikstür: dinlenme günü, 7/14 gündeki maç sayısı ve Avrupa maçı;
- bağlam: teknik direktör değişimi ve değişimden beri maç sayısı;
- düşük ağırlıklı H2H: en fazla 5 maç, en fazla 3 yıl ve zaman azalımı;
- opsiyonel: oyuncu önem ağırlıklı kadro eksikleri;
- opsiyonel piyasa: vig temizlenmiş 1/X/2 ve üst 2.5 olasılıkları.

Eksik xG, kadro veya oran verisi açık bir missingness flag ile temsil edilir;
pipeline'ı durdurmaz. Recency ağırlığı configurable half-life ile exponential
decay kullanır. `league_id` her ortak ML modelinde zorunludur.

## Veri ve eğitim akışı

`provider -> raw validation -> canonical upsert -> chronological feature
snapshot -> train/validate/test folds -> calibration -> ensemble optimization
-> immutable prediction -> result settlement -> monitoring`

Random split yasaktır. Walk-forward pencereleri kronolojik kurulur. Feature
üreticisi `as_of < kickoff_at` şartını uygular; odds, sakatlık ve kadro verileri
de kendi gözlem zamanlarıyla filtrelenir. Calibration ve ensemble ağırlıkları
test fold'una bakmadan validation fold'unda öğrenilir.

## Model mimarisi

- **Dixon-Coles:** Lig/tarih ağırlıklı hücum-savunma güçleri, lig bazlı ev
  avantajı ve düşük skor korelasyonu; en az 0-0..6-6 matrisi.
- **Elo:** Lig başına dinamik rating; sonuç, rakip, gol farkı ve öğrenilen ev
  avantajı ile sadece kronolojik güncelleme.
- **ML:** Başlangıçta LightGBM multiclass 1/X/2 ve ayrı binary üst 2.5 modeli.
  Ham olasılıklar fold büyüklüğüne göre isotonic veya Platt ile kalibre edilir.
- **Ensemble:** Varsayılan `(ML=.45, DC=.35, Elo=.20)` yalnızca başlangıçtır;
  log loss/Brier hedefiyle lig bazında simplex üzerinde optimize edilir.
- **Confidence:** En yüksek ensemble olasılığı, model anlaşması, calibration
  güvenilirliği ve veri tamlığını birlikte kullanır.

Üretim terfisi; walk-forward Brier/log loss gerilememesi ve beraberlik dahil
sınıf metriklerinin raporlanması koşuluna bağlıdır. Açıklamalar yalnızca
snapshot'taki gerçek özelliklerden şablonlu olarak üretilir.

## Hedef klasör yapısı

```text
backend/
  alembic/                 # migration'lar
  app/
    api/                   # FastAPI router'ları
    core/                  # ayarlar ve logging
    db/                    # session, metadata
    models/                # SQLAlchemy modelleri
    schemas/               # Pydantic giriş/çıkışları
    providers/             # CSV/API adapter'ları
    features/              # point-in-time feature üretimi
    modeling/              # Elo, Dixon-Coles, ML, calibration, ensemble
    services/              # ingestion, prediction, backtest
  tests/
frontend/                  # PHASE 11 Next.js uygulaması
docs/                      # mimari ve karar kayıtları
```

