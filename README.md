# İDDA Analiz Merkezi

Windows için veri odaklı futbol maç analiz uygulaması.

## Kurulum

GitHub Releases bölümündeki `IDDA-Analiz-Merkezi-Kurulum-1.2.1.exe` dosyasını indirin ve çalıştırın. Kurulum sihirbazı masaüstü ve Başlat menüsü kısayollarını oluşturur. Kurulum istemeyen kullanım için taşınabilir sürüm de yayımlanmaktadır.

## v1.2.1 yabancı lig veri bağlantısı

- Ayarlar düğmesi görünürdür; kaydedilen API-Football anahtarı yabancı lig sorgularını otomatik etkinleştirir.
- Premier League, La Liga, Bundesliga, Serie A ve Ligue 1 fikstürleri API-Football üzerinden alınır.
- Anahtar yoksa uygulama yalnızca ücretsiz TFF/Süper Lig verisini gösterdiğini açıkça belirtir.
- Bir lig veya veri isteği başarısız olursa hata arayüzde görünür; sessizce boş liste gösterilmez.

## Tek tuşla kupon

`Tek tuşla kupon hazırla` düğmesi haftadaki bütün maçları analiz eder, sıkı güven eşiğini geçen farklı maçlardan en fazla beş seçim gösterir. Eşiği geçen maç sayısı beşten azsa liste zorla tamamlanmaz. İstatistiksel analiz sonuç veya kazanç garantisi değildir.

Muhtemel maç sonucu standart olarak `1 = ev sahibi galibiyeti`, `0 = beraberlik`, `2 = deplasman galibiyeti` biçiminde gösterilir. Yüzde değeri istatistiksel güveni ifade eder; kesin sonuç garantisi değildir.

`Sürpriz kupon` düğmesi ana kupona girmeyen dengeli maçlar, beraberlikler ve sınırdaki gol göstergelerinden en fazla üç yüksek riskli seçim üretir. Oran verisi kullanılmadığı için yüksek oran iddiası taşımaz.

Süper Lig haftalık karşılaşmalarını TFF ve SportScore verileriyle, beş büyük Avrupa ligini API-Football verileriyle inceleyen yerel uygulama.

## Çalıştırma

1. PowerShell'de proje klasörüne girin.
2. `npm start` komutunu çalıştırın.
3. Tarayıcıda `http://127.0.0.1:4173` adresini açın.

Herhangi bir paket kurulumu gerekmez. Node.js 20 veya daha yeni bir sürüm yeterlidir.

## Veri kaynakları

Güncel Süper Lig fikstürü TFF'nin resmî sayfasından, takım geçmişi ve performans verileri SportScore ücretsiz API'sinden alınır. Bu kullanım için API anahtarı gerekmez. Beş büyük Avrupa ligi için Ayarlar bölümüne API-Football anahtarı girilmelidir. SportScore kullanım şartı gereği arayüzde kaynak bağlantısı gösterilir.

Ücretsiz planın günlük kotasını korumak için yanıtlar varsayılan olarak 6 saat önbelleğe alınır. `Verileri yenile` düğmesi önbelleği atlar ve altı API isteği kullanır.

## Mevcut aşama

- Altı lig için haftalık fikstür
- Demo veri modu
- API-Football bağlantısı
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
