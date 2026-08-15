# İDDA Analiz Merkezi

Windows için veri odaklı futbol maç analiz uygulaması.

## Kurulum

GitHub Releases bölümündeki `IDDA-Analiz-Merkezi-Kurulum-1.0.0.exe` dosyasını indirin ve çalıştırın. Kurulum sihirbazı masaüstü ve Başlat menüsü kısayollarını oluşturur. Kurulum istemeyen kullanım için taşınabilir sürüm de yayımlanmaktadır.

Süper Lig haftalık karşılaşmalarını TFF ve SportScore verileriyle inceleyen yerel web uygulaması. Avrupa ligleri için sağlayıcı bağlantıları geliştirme aşamasındadır.

## Çalıştırma

1. PowerShell'de proje klasörüne girin.
2. `npm start` komutunu çalıştırın.
3. Tarayıcıda `http://127.0.0.1:4173` adresini açın.

Herhangi bir paket kurulumu gerekmez. Node.js 20 veya daha yeni bir sürüm yeterlidir.

## Veri kaynakları

Güncel Süper Lig fikstürü TFF'nin resmî sayfasından, takım geçmişi ve performans verileri SportScore ücretsiz API'sinden alınır. API anahtarı gerekmez. SportScore kullanım şartı gereği arayüzde kaynak bağlantısı gösterilir.

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
