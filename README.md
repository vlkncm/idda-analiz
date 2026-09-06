# Ücretsiz Avrupa Futbol Olasılık Motoru

## Production analiz mimarisi

Windows/Electron uygulamasının tek production analiz motoru kökteki
`probability-engine.js` modülüdür. Akış `server.js` üzerinden
`free-provider.js` / `international-analysis-provider.js` ile bu motora gider.
Python/FastAPI kodu masaüstü runtime'ında başlatılmaz; araştırma, veri senkronu ve
offline model karşılaştırma aracıdır. `analyzer.js` yalnız `legacy` karşılaştırma
uyumluluğu için tutulur ve production önerisi üretmez.

Motor; tarih-noktalı veri filtresi, 180 günlük yarı ömür, iç/dış saha güçleri,
0–5 normalize Dixon–Coles matrisi, kronolojik Elo ve train/validation/test
ayrımı kullanır. Validation döneminde ensemble ağırlıkları ile sıcaklık
kalibrasyonu seçilir. Yeni motor dokunulmamış test döneminde lig frekansı
baseline'ını log loss ve Brier ölçütlerinde geçmezse standart Poisson/Elo
hesabıyla devam edilir ve bu sınır açıkça belirtilir. Yalnız uygun ev/deplasman
örneklerinden biri 3 maçın altındaysa `VERİ YETERSİZ` gösterilir. xG, sakatlık
önemi, hakem veya güncel oran yoksa değer uydurulmaz ve alan modelden çıkarılır.

Gerçek veri doğrulama durumu ve bilinen sınırlar için
[`MODEL_VALIDATION_REPORT.md`](MODEL_VALIDATION_REPORT.md) dosyasına bakın.

## Güncel Electron/Node fikstür uygulaması

Varsayılan `npm start` komutu kök dizindeki Node sunucusunu çalıştırır. Güncel
fikstürlerin birincil kaynağı ESPN'in anahtarsız genel futbol verisidir. Opsiyonel
anahtarlarınızı gerçek `.env` dosyanıza yazın; anahtar tarayıcıya gönderilmez ve loglanmaz:

```powershell
Copy-Item .env.example .env
# ESPN için anahtar gerekmez; opsiyonel kaynak anahtarları boş kalabilir
npm test
npm start
```

Uygulama `http://127.0.0.1:4173` adresinde açılır. Fallback sırası Süper Lig için
ESPN, TheSportsDB, TFF ve opsiyonel API-Football; beş büyük Avrupa ligi için ESPN,
TheSportsDB, football-data.org, Football-Data.co.uk ve opsiyonel API-Football şeklindedir. Demo maçlar
production fikstür akışında kullanılmaz.

Bu sürüm aylık veri maliyeti **0** olacak şekilde çalışır. Ana kaynak
[Football-Data.co.uk](https://www.football-data.co.uk/data.php) ücretsiz CSV
dosyalarıdır. Türkiye `T1`, İngiltere `E0`, Almanya `D1`, İtalya `I1` ve Fransa
`F1` kodları kaynağın güncel indirme sayfalarından doğrulanmıştır. Opsiyonel
`football-data.org` v4 sağlayıcısı anahtar yoksa sessizce atlanır. Sportmonks
yalnızca geriye dönük uyumluluk için opsiyoneldir; normal kurulumda kullanılmaz.

Olasılıklar kesin sonuç, garanti veya bahis tavsiyesi değildir.

## Hızlı başlangıç (Docker)

```powershell
Copy-Item .env.example .env
docker compose up --build
docker compose exec backend python -m app.cli bootstrap
```

Herhangi bir API anahtarı zorunlu değildir. İsterseniz ücretsiz
football-data.org hesabınızın anahtarını `.env` içindeki
`FOOTBALL_DATA_API_KEY` alanına ekleyebilirsiniz.

- Uygulama: http://localhost:3000
- API: http://localhost:8000/api/v1
- Swagger: http://localhost:8000/docs
- Admin: http://localhost:3000/admin

## Yerel SQLite kurulumu

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
python -m alembic upgrade head
python -m app.cli bootstrap
uvicorn app.main:app --reload
```

Varsayılan `DATABASE_URL=sqlite:///./idda_analysis.db` değeridir. Docker Compose
PostgreSQL kullanır.

## Günlük komutlar

```powershell
python -m app.cli sync                    # ücretsiz CSV sync
python -m app.cli sync --history-seasons 8
python -m app.cli train
python -m app.cli backtest --league TR-SL
python -m app.cli predict
python -m app.cli status
```

`bootstrap`; beş ligi ve geçmiş sezonları indirir, idempotent olarak DB'ye
yazar, pre-match Elo geçmişini/feature'ları oluşturur, walk-forward training ve
backtest yapar, uygun upcoming maçlar varsa tahmin üretir. CSV kaynağı geçici
olarak erişilemiyorsa yeniden çalıştırılabilir; duplicate oluşturmaz.

Football-Data kolonları eksik olduğunda NULL saklanır. CSV'deki `C` kolonları
closing fiyatı taşısa da kesin snapshot zamanı yayımlanmadığı için bu oranlar
point-in-time modele veya value hesabına alınmaz. Ayrı bir sağlayıcı gerçek
`captured_at < kickoff` zamanı verdiğinde oranlar vig temizlendikten sonra modele
girebilir; leakage testi bu koşulu denetler.

Veriler Football-Data.co.uk tarafından maç tahmini/araştırma amacıyla ücretsiz
sunulur. Kaynağa atıf korunmalı ve yeniden dağıtım/ticari kullanım öncesinde
güncel kullanım şartları ayrıca kontrol edilmelidir. İstemci yalnız resmi CSV
download uçlarını, düşük sıklıkta ve seri şekilde çağırır; CAPTCHA veya anti-bot
mekanizması aşmaz.

## Testler

```powershell
cd backend
pytest
ruff check .
cd ..\frontend
npm run typecheck
npm run lint
npm run build
```

## Sorun giderme

- CSV indirme timeout/429: Kaynağa yük bindirmeden birkaç dakika sonra `sync`
  komutunu yeniden çalıştırın.
- `insufficient_data`: En az beş sezon indirin; varsayılan sekiz sezondur.
- Model artifact yok: Sırasıyla `sync`, `train`, `predict` çalıştırın.
- Ücretsiz API anahtarı yok: Sorun değildir; ana CSV akışı anahtarsızdır.

---

# Önceki Sportmonks tabanlı production notları

Sportmonks Football API v3 verisini PostgreSQL'e senkronize eden; lig bazlı Elo,
Dixon-Coles ve kalibre edilmiş LightGBM ensemble modeliyle `1/X/2` ve `2.5 ÜST`
olasılıkları üreten FastAPI + Next.js uygulamasıdır. Olasılıklar kesin sonuç veya
kazanç garantisi değildir.

## 1. Gereksinimler

- Docker Desktop ve Docker Compose (önerilen), veya Python 3.12+, PostgreSQL ve Node.js 20+
- Hedef ligleri kapsayan bir Sportmonks Football API aboneliği ve API anahtarı

## 2. Sportmonks API anahtarı

Proje gerçek `.env` dosyası veya API anahtarı içermez. Kök dizinde:

```powershell
Copy-Item .env.example .env
```

Oluşturduğunuz `.env` dosyasında yalnız şu alanı doldurun:

```dotenv
SPORTMONKS_API_KEY=gercek_anahtariniz
```

Anahtar yalnız backend tarafından okunur; loglara ve browser bundle'ına girmez.
Anahtar yoksa backend çalışır, fakat sync komutu anlaşılır bir hata verir.

Provider güncel resmî v3 endpointlerini kullanır: [leagues](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/leagues),
[season schedules](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/schedules/get-schedules-by-season-id),
[fixtures](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/fixtures/get-all-fixtures) ve
[pre-match odds](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/standard-odds-feed/pre-match-odds/get-odds-by-fixture-id).

## 3. Docker ile çalıştırma

```powershell
docker compose up --build
```

Servisler:

- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- Swagger: http://localhost:8000/docs
- OpenAPI JSON: http://localhost:8000/openapi.json

Backend container'ı açılırken `alembic upgrade head` otomatik çalışır.

## 4. Manuel migration

```powershell
cd backend
python -m alembic upgrade head
```

## 5. Veri senkronizasyonu

```powershell
docker compose exec backend python -m app.cli sync
```

Sync hedef ligleri isim ve ülke eşleşmesiyle keşfeder; lig ID'leri hard-code
değildir. Aynı provider verisi tekrar işlendiğinde duplicate oluşturmaz. Fixture,
istatistik, xG, lineup, sakatlık ve erişilebilen oranlar güncellenir. 429 cevapları
Sportmonks `retry_after` değerine göre beklenir.

## 6. Training

```powershell
docker compose exec backend python -m app.cli train
```

Training kronolojik feature datasetini veritabanından üretir. Random split
kullanmaz; geçmiş sezonları training, sonraki sezonları validation/test olarak
işler. LightGBM, Logistic Regression baseline, calibration ve lig bazlı ensemble
karşılaştırılır. Yetersiz geçmiş verili ligler açıkça raporlanır.

## 7. Backtest

```powershell
docker compose exec backend python -m app.cli backtest --league TR-SL
```

Rapor accuracy yanında Brier, log loss, calibration error, 1/X/2 sınıf
başarıları, draw precision/recall/F1 ve probability bucket sonuçlarını içerir.

## 8. Upcoming predictions

```powershell
docker compose exec backend python -m app.cli predict
docker compose exec backend python -m app.cli status
```

Production model artifact'i yoksa sistem tahmin uydurmaz. Scheduler varsayılan
olarak Docker ortamında açıktır: günlük genel sync ve kickoff'tan yaklaşık 90
dakika önce refresh/prediction çalıştırır. Development ortamında
`SCHEDULER_ENABLED=false` kullanılabilir.

## 9. Frontend

Ana ekran lig filtreleri ve maç kartlarını; `/matches/{id}` maç detayı Elo, form,
xG, model agreement ve deterministic açıklamayı; `/admin` model/backtest/feature
importance görünümünü sunar.

## 10. API

Başlıca uçlar `/api/v1` altındadır:

- `GET /leagues`, `/seasons`, `/matches/upcoming`
- `GET /matches/{id}`, `/matches/{id}/prediction`, `/predictions`
- `GET /model/current`, `/model/metrics`
- `POST /admin/sync`, `/admin/train`, `/admin/backtest`

## 11. Test ve kalite kontrolleri

```powershell
cd backend
pytest
ruff check app tests

cd ..\frontend
npm run typecheck
npm run lint
npm run build
```

## 12. Sorun giderme

- `SPORTMONKS_API_KEY tanımlı değil`: `.env` içine anahtarı ekleyin ve backend'i yeniden başlatın.
- Hedef lig bulunamadı: Sportmonks aboneliğinizde lig kapsamını kontrol edin.
- `insufficient_data`: Daha fazla geçmiş sezon senkronize edin; sistem eksik veriyle production model terfi ettirmez.
- `409 trained model artifact...`: Önce `sync`, sonra `train` çalıştırın.
- PostgreSQL bağlantı hatası: `.env` içindeki kullanıcı, parola, veritabanı ve `DATABASE_URL` değerlerini eşleştirin.

---

# Eski IDDA Analiz Merkezi

Windows için veri odaklı futbol maç analiz uygulaması.

## Kurulum

GitHub Releases bölümündeki `IDDA-Analiz-Merkezi-Kurulum-1.2.1.exe` dosyasını indirin ve çalıştırın. Kurulum sihirbazı masaüstü ve Başlat menüsü kısayollarını oluşturur. Kurulum istemeyen kullanım için taşınabilir sürüm de yayımlanmaktadır.

## v1.2.1 yabancı lig veri bağlantısı

- Premier League, La Liga, Bundesliga, Serie A ve Ligue 1 fikstürleri TheSportsDB üzerinden alınır.
- Anahtar yoksa Süper Lig TFF'den; Premier League, La Liga, Bundesliga, Serie A ve Ligue 1 fikstürleri TheSportsDB'nin ücretsiz API'sinden yüklenir.
- Bir lig veya veri isteği başarısız olursa hata arayüzde görünür; sessizce boş liste gösterilmez.

## Tek tuşla kupon

`Tek tuşla kupon hazırla` düğmesi haftadaki bütün maçları analiz eder, sıkı güven eşiğini geçen farklı maçlardan en fazla beş seçim gösterir. Eşiği geçen maç sayısı beşten azsa liste zorla tamamlanmaz. İstatistiksel analiz sonuç veya kazanç garantisi değildir.

Muhtemel maç sonucu standart olarak `1 = ev sahibi galibiyeti`, `0 = beraberlik`, `2 = deplasman galibiyeti` biçiminde gösterilir. Yüzde değeri istatistiksel güveni ifade eder; kesin sonuç garantisi değildir.

`Sürpriz kupon` düğmesi ana kupona girmeyen dengeli maçlar, beraberlikler ve sınırdaki gol göstergelerinden en fazla üç yüksek riskli seçim üretir. Oran verisi kullanılmadığı için yüksek oran iddiası taşımaz.

Süper Lig haftalık karşılaşmalarını TFF ve SportScore verileriyle, beş büyük Avrupa ligini TheSportsDB verileriyle inceleyen yerel uygulama.

## Çalıştırma

1. PowerShell'de proje klasörüne girin.
2. `npm start` komutunu çalıştırın.
3. Tarayıcıda `http://127.0.0.1:4173` adresini açın.

Herhangi bir paket kurulumu gerekmez. Node.js 20 veya daha yeni bir sürüm yeterlidir.

## Veri kaynakları

Altı ligin güncel fikstürü önce ESPN'den alınır; lig bazında başarısız olursa TheSportsDB ve mevcut ücretsiz kaynaklara geçilir. Geçmiş analizleri Football-Data.co.uk CSV'leri, bu verinin açık GitHub arşivi, TheSportsDB ve Süper Lig için OpenFootball kayıtları besler.

Yanıtlar varsayılan olarak 360 dakika önbelleğe alınır. `Maçları Güncelle` düğmesi önbelleği kontrollü yeniler; 60 saniyelik hız sınırı yinelenen istekleri engeller. Güncel veri alınamazsa yalnız aynı lig, tarih aralığı ve şema sürümüne ait son doğrulanmış cache kullanılabilir.

## Mevcut aşama

- Altı lig için haftalık fikstür
- Production akışında demo veri yoktur; kaynaklar başarısızsa açık hata gösterilir
- TheSportsDB bağlantısı
- Dosya tabanlı önbellek
- Lig filtreleri ve maç ayrıntısı
- Sakat ve cezalı oyuncu listesi
- Son iç saha/deplasman formu
- Son 10 karşılaşma ve H2H analizi
- Hakemin takımlarla geçmiş sonuçları
- İlk ve ikinci yarı gol eğilimleri
- 2.5 üst ve karşılıklı gol yüzdeleri
- Oyuncuların son üç maç performansı
- Veri güven skoru

> Uygulama istatistiksel değerlendirme sunar; sonuç veya kazanç garantisi vermez.
