# Geliştirme fazları

| Faz | Durum | Uygulama |
|---|---|---|
| 1 Database + match model | Tamamlandı | SQLAlchemy çekirdek modelleri ve Alembic 0001 |
| 2 CSV/API ingestion | Tamamlandı | `DataProvider`, CSV adapter ve idempotent ingestion |
| 3 Elo | Tamamlandı | Lig kapsamlı rating ve öğrenilebilir ev avantajı |
| 4 Dixon-Coles | Tamamlandı | Düşük skor düzeltmeli normalize skor matrisi |
| 5 Features | Tamamlandı | Point-in-time 5/10 form, saha, xG, dinlenme, H2H, koç, kadro, piyasa |
| 6 ML | Tamamlandı | LightGBM multiclass ve binary modeller |
| 7 Calibration | Tamamlandı | Veri boyutuna göre Platt/isotonic calibration |
| 8 Ensemble | Tamamlandı | Lig bazında log-loss ile optimize ağırlıklar ve agreement confidence |
| 9 Backtest | Tamamlandı | Walk-forward split ve kapsamlı 1/X/2 + üst 2.5 metrikleri |
| 10 FastAPI | Tamamlandı | Lig, maç, tahmin, inference, backtest ve admin uçları |
| 11 Next.js | Tamamlandı | Mobil tahmin ekranı, lig filtreleri ve model merkezi |
| 12 Monitoring | Tamamlandı | Metric/importance kayıtları ve gerileme engelleyen promotion gate |

"Tamamlandı" kod yolunun ve otomatik testinin mevcut olduğunu ifade eder. Gerçek
tahmin kalitesi ancak lisanslı/tutarlı tarihsel veri yüklenip lig başına uzun
dönem walk-forward backtest çalıştırıldıktan sonra ölçülebilir. Model artifact'i
olmadan API tahmin uydurmaz; açık bir `409` yanıtı verir.

