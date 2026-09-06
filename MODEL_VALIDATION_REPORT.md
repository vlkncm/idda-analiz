# Doğrulama raporu — 6 Eylül 2026 / 1.4.2

## Canlı sonuç

Zaman: 2026-09-06T20:12:51.868Z. Kod kökü: C:\Users\yeliz\Projects\idda-analiz.
Eski kurulu EXE kullanılmadı; yerel sunucu sürüm 1.4.2 ve yeni motoru doğruladı.
Aralık: önümüzdeki 14 gün. Sayılar kaynağın bu çalışmada döndürdüğü gerçek kayıtlardır; bütün sezonun tamamlandığı iddiası değildir.

| Lig | Yaklaşan maç | Gerçek geçmiş sonuç |
|---|---:|---:|
| Süper Lig | 20 | 850 |
| Premier League | 20 | 1170 |
| La Liga | 31 | 1178 |
| Bundesliga | 18 | 936 |
| Serie A | 22 | 1167 |
| Ligue 1 | 18 | 944 |
| Toplam | 129 | 6245 |

129 maç uygulamanın sunucu analiz akışında incelendi.
Kararlar: TEMKİNLİ SEÇENEK: 4; GÜÇLÜ SEÇENEK: 97; VERİ YETERSİZ: 28.
YÜKSEK RİSK: 0; PAS GEÇ: 0; analiz istisnası: 0.
Kupona uygun 101 maçtan 5 farklı maç seçildi. 28 maç veri nedeniyle elendi; uygun 96 aday kapasite nedeniyle listeye alınmadı. Eşikler düşürülmedi.

Altı lig fikstürü ESPN'den geldi. Football-Data.co.uk doğrudan erişimi zaman aşımı/bağlantı hatası verdi; Avrupa geçmişi bu kaynağın GitHub arşivinden, Türkiye geçmişi OpenFootball'dan ve eksik güncel sezon ESPN'den alındı. Yedek kaynağın çalışması birincil kaynağın çalıştığı anlamına gelmez. [Ham sonuçlar ve kaynak hataları](validation/live-results.json).

## Yeterli seçim üretilemeyen maçlar

Uygun iç saha veya deplasman örneği 3'ün altında. Alt lig sonuçları üst lig sonucu gibi kullanılmadı; yeni yükselen takımlar için geçmiş uydurulmadı.

| Maç | Neden |
|---|---|
| Beşiktaş - Erzurumspor | Erzurumspor deplasman geçmişi 2/3 |
| Union Berlin - Schalke 04 | Schalke 04 deplasman geçmişi 1/3 |
| Santander - Alavés | Santander iç saha geçmişi 2/3 |
| Dortmund - Paderborn | Paderborn deplasman geçmişi 1/3 |
| Samsunspor - Çorum FK | Çorum FK deplasman geçmişi 2/3 |
| Chelsea - Hull | Hull deplasman geçmişi 1/3 |
| Celta - Málaga | Málaga deplasman geçmişi 2/3 |
| Coventry City - Brighton | Coventry City iç saha geçmişi 1/3 |
| Lille - Troyes | Troyes deplasman geçmişi 1/3 |
| Le Mans - Lens | Le Mans iç saha geçmişi 1/3 |
| SV Elversberg - Bayern Munich | SV Elversberg iç saha geçmişi 1/3 |
| Getafe - Deportivo | Deportivo deplasman geçmişi 2/3 |
| Amed SFK - Başakşehir | Amed SFK iç saha geçmişi 2/3 |
| Deportivo - Sevilla | Deportivo iç saha geçmişi 2/3 |
| Barcelona - Santander | Santander deplasman geçmişi 2/3 |
| Málaga - Villarreal | Málaga iç saha geçmişi 2/3 |
| Çorum FK - Alanyaspor | Çorum FK iç saha geçmişi 2/3 |
| Newcastle United - Hull | Hull deplasman geçmişi 1/3 |
| Nottingham Forest - Coventry City | Coventry City deplasman geçmişi 2/3 |
| Celta - Santander | Santander deplasman geçmişi 2/3 |
| Angers - Troyes | Troyes deplasman geçmişi 1/3 |
| Le Mans - Lorient | Le Mans iç saha geçmişi 1/3 |
| Getafe - Málaga | Málaga deplasman geçmişi 2/3 |
| Erzurumspor - Samsunspor | Erzurumspor iç saha geçmişi 2/3 |
| Schalke 04 - SV Elversberg | Schalke 04 iç saha geçmişi 1/3; SV Elversberg deplasman geçmişi 1/3 |
| Deportivo - Real Betis | Deportivo iç saha geçmişi 2/3 |
| Amed SFK - Beşiktaş | Amed SFK iç saha geçmişi 2/3 |
| Paderborn - Hoffenheim | Paderborn iç saha geçmişi 1/3 |

## Düzeltmeler

- ESPN birincil kaynak; lig bazında TheSportsDB ve mevcut kaynaklara geçiş, süre sınırı, hata görünürlüğü, tekilleştirme ve Türkiye saati.
- Merkezi takım eşleştirmesi: sponsorlar, Türkçe karakterler, kulüp ekleri ve kaynak kısaltmaları; kısa adlar alt dizeyle eşleştirilmez.
- Lig/sezon bazında 6 saat geçmiş önbelleği, eşzamanlı indirmeyi paylaşma ve her isteğin kendi tarih filtresi. Boş indirme yalnız 30 saniye bekletilir.
- Sonuçlar kronolojik işlenir; en yeni 5/10 uygun saha maçı seçilir. Boş skor sıfır sayılmaz.
- Yeterli veride en güçlü pazar, alternatifler, veri güveni ve olasılık ayrı gösterilir. Kupon model yüzdesini korur; yapay beraberlik yüzdesi kaldırıldı.
- Dixon–Coles/Poisson 0–20 hesabı; ekranda 0–5 matrisi ve dışarıda kalan pay. 1X2 ve ters pazar toplamları canlı maçlarda da sınanır.
- Devre eğilimleri ilgili takımların uygun saha geçmişinden gelir; bulunmayan devre skoru katılmaz.
- ESPN kimliği TFF kadro kimliği gibi sorgulanmaz; ek veri hatası analizi durdurmaz.
- GitHub main üzerindeki önceki üç düzeltme birleştirildi. Backend ve frontend çalışmaları korundu.

## Testler ve sınırlar

- Node: 92 geçti, 0 başarısız.
- Python: 37 geçti, 1 isteğe bağlı test atlandı. Starlette/httpx deprecation uyarısı var.
- Backend ruff, frontend TypeScript/ESLint/production build ve public/app.js sözdizimi başarılı.
- Canlı doğrulama: 129 maç, altı ligde canlı fikstür ve gerçek geçmiş, 30'dan fazla seçim, olasılık toplamları ve kupon başarılı.

Bunlar veri akışı ve hesap tutarlılığı testleridir; gelecekteki tahmin başarısını veya kazancı garanti etmez.
xG/xGA, doğrulanmış oyuncu önemi ve hakem istatistiği bulunmadığında bu alanlar modele eklenmez.
Puan tablosu alınan sonuçlardan hesaplanır; idari puan cezalarını doğrulayan bağımsız resmi tablo değildir.

## Windows

Eski kurulu uygulama GitHub main güncellenince otomatik güncellenmez.
Yeni sürüm üretmek için proje kökünde:

```powershell
npm ci
npm test
npm run build
```

Çıktılar: dist/IDDA-Analiz-Merkezi-Kurulum-1.4.2.exe ve dist/IDDA-Analiz-Merkezi-Tasinabilir-1.4.2.exe.
Geliştirme kodu: npm run desktop. Paketler Authenticode sertifikasıyla imzalı değildir.
Her iki Windows paketi başarıyla üretildi. Kurulum 100443889 bayt, taşınabilir paket 100213736 bayt.
app.asar içindeki sürüm 1.4.2 olarak doğrulandı; server.js, probability-engine.js, international-provider.js, fixture-providers/model.js ve public/app.js güncel kaynakla bayt düzeyinde aynı. Authenticode durumu NotSigned. Kurulum sihirbazı kullanıcı hesabına kurulmadı.

## Değiştirilen dosyalar (önceki GitHub main'e göre)

- `.env.example`
- `.gitignore`
- `MODEL_VALIDATION_REPORT.md`
- `README.md`
- `backend/alembic/versions/20260823_0004_global_betting.py`
- `backend/alembic/versions/20260903_0005_add_la_liga.py`
- `backend/app/api/routes.py`
- `backend/app/cli.py`
- `backend/app/core/config.py`
- `backend/app/features/builder.py`
- `backend/app/models/__init__.py`
- `backend/app/models/operational.py`
- `backend/app/providers/football_data_org.py`
- `backend/app/providers/football_data_uk.py`
- `backend/app/providers/odds_base.py`
- `backend/app/providers/sportmonks.py`
- `backend/app/providers/the_odds_api.py`
- `backend/app/services/global_betting.py`
- `backend/app/services/sportmonks_sync.py`
- `backend/tests/test_engines.py`
- `backend/tests/test_free_providers.py`
- `backend/tests/test_global_betting.py`
- `backend/tests/test_sportmonks.py`
- `electron.js`
- `enrichment-provider.js`
- `fixture-providers/api-football.js`
- `fixture-providers/base.js`
- `fixture-providers/espn.js`
- `fixture-providers/football-data-org.js`
- `fixture-providers/football-data-uk.js`
- `fixture-providers/http.js`
- `fixture-providers/manager.js`
- `fixture-providers/model.js`
- `fixture-providers/tff.js`
- `fixture-providers/the-sports-db.js`
- `fixture-service.js`
- `free-provider.js`
- `frontend/app/betting.css`
- `frontend/app/layout.tsx`
- `frontend/app/matches/[id]/page.tsx`
- `frontend/components/GlobalBetting.tsx`
- `frontend/lib/api.ts`
- `international-analysis-provider.js`
- `international-provider.js`
- `package-lock.json`
- `package.json`
- `probability-engine.js`
- `public/analysis.css`
- `public/app.js`
- `public/index.html`
- `public/styles.css`
- `scripts/live-validation.js`
- `server.js`
- `test/api-football-provider.test.js`
- `test/completion-regression.test.js`
- `test/fixture-model.test.js`
- `test/fixture-providers.test.js`
- `test/fixture-service.test.js`
- `test/international-analysis-provider.test.js`
- `test/international-provider.test.js`
- `test/probability-engine.test.js`
- `test/six-league-regression.test.js`
- `validation/live-results.json`
