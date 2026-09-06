# Model doğrulama raporu — 3 Eylül 2026

1. **Önceki sistemin hataları:** `analyzer.js` sabit eşikler, elle oluşturulan
   “güven” yüzdeleri, tarih filtresiz H2H ve iç/dış saha yedeği kullanıyordu.
2. **Production motoru:** Electron → yerel `server.js` → analiz sağlayıcısı →
   `probability-engine.js`. FastAPI masaüstünde başlatılmıyor.
3. **Değiştirilen ana dosyalar:** `probability-engine.js`, iki analiz sağlayıcısı,
   `server.js`, `public/app.js`, `public/analysis.css`, backend feature/CLI ve testler.
4. **Kullanılan alanlar:** lig, sezon, tarih, takımlar, tam/ilk yarı skorları,
   mevcutsa şut/isabetli şut/kırmızı kart; yaklaşan maç durumu ve hakem.
5. **Eksik alanlar:** yerel veritabanında gerçek xG, oyuncu sezon istatistikleri,
   seyahat koordinatları ve zaman damgalı güncel oran snapshotları yok.
6. **Dixon–Coles:** 0–10 gol matrisi; `rho` 80+ lig maçında `[-0.20, 0.20]`
   grid likelihood ile seçilir, aksi halde `rho=0` Poisson fallback raporlanır.
7. **Elo:** başlangıç 1500, K=24, ev avantajı 65, gol farkı çarpanı en fazla 1.75;
   maçlar yalnız kronolojik işlenir.
8. **Kalibrasyon:** validation döneminde 0.70–1.50 arası temperature scaling;
   1X2 ve gol/KG pazarları ayrı sıcaklıklarla kalibre edilir.
9. **Ensemble:** Dixon–Coles/Elo ağırlığı validation log loss ile 0.05 adımda
   seçilir. ML ve piyasa ağırlığı veri/artifact olmadığı için sıfırdır.
10. **Altı lig veri yeterliliği:** fikstür ve sağlayıcı regresyonu altı ligde
    geçti. Yerel backend DB 0 maç içeriyor; gerçek lig bazlı yeterlilik
    doğrulanamadı. Ağdan CSV indirme bu çalışmada başarısız oldu.
11. **Backtest:** gerçek veri olmadığı için sonuç üretilmedi;
    `{status: insufficient_data, matches: 0}` döndü.
12. **Eski/yeni karşılaştırma:** motor test fold'unda hem lig frekansı
    baseline'ını hem eski eşik motorunu log loss ve Brier'da geçmeden promotion
    yapmaz. Yerel veri boş olduğundan gerçek sayısal karşılaştırma yoktur.
13. **PAS GEÇ:** az takım/venue örneği, artifact yokluğu, başarısız promotion,
    model çelişkisi ve ertelenmiş/iptal maçlarda zorunludur.
14. **Leakage:** kickoff sonrası maçlar ve duplicate'ler atılır; Elo kronolojik;
    calibration validation'da, promotion dokunulmamış testte yapılır.
15. **Gerçek xG:** mevcut ücretsiz altı lig geçmiş kaynağında doğrulanmadı;
    arayüz “xG verisi mevcut değil” der, sıfır yazmaz.
16. **Oyuncu önemi:** istenen 30/20/15/10/10/10/5 formülü uygulanır. Gerekli
    bileşenler yoksa “Doğrulanamadı” kalır ve lambda değiştirilmez.
17. **Value zamanı:** yalnız `capturedAt < kickoff` olan 1X2 oranı kabul edilir.
    Mevcut masaüstü sağlayıcısı bu snapshotı vermediği için value üretilmez.
18. **Testler:** kök Node 71/71; backend pytest 37 geçti, 1 opsiyonel test skip;
    ruff, frontend typecheck/lint/build geçti. Electron `win-unpacked` paketi ve
    6.123.302 baytlık `app.asar` başarıyla üretildi ve içinde
    `probability-engine.js` ile `public/analysis.css` doğrulandı.
19. **Windows ekranı:** `npm run desktop`, ligden maç seç, **Analiz Et**. Yeni
    özet, pazarlar, puan tablosu, H2H, eksikler ve model ayrıntısı aynı pencerede.
20. **Doğrulanamayanlar:** gerçek altı lig backtest metrikleri, gerçek xG kapsamı,
    kadro önem katsayısının saha etkisi, closing-line ROI ve canlı paket kurulum
    testi veri/ağ yokluğu nedeniyle doğrulanmadı; bu alanlarda başarı iddiası yoktur.
    Paket doğrulama klasörü kontrolden sonra silindi; mevcut `dist` korunmuştur.
    Bu oturumda bağlı görsel tarayıcı bulunmadığı için ekran görüntüsü QA'sı yapılamadı.

Olasılıklar kesin sonuç veya kazanç garantisi değildir.

## Windows çıktısı

`1.4.1` sürümü için kurulum ve taşınabilir EXE dosyaları `dist` klasöründe
üretilmiştir. Dosyalar Authenticode sertifikasıyla imzalı değildir; Windows
SmartScreen yayımlayıcı uyarısı gösterebilir.
