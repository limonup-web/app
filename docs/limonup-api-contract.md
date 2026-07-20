# LimonUp Şarj API Sözleşmesi

Bu sözleşme web ve mobil istemcilerin aynı veri yapısını kullanması için başlangıç dokümanıdır.

## Station

```json
{
  "stationNo": "ŞRJ/2188",
  "name": "Mersin Migros",
  "brand": "zes",
  "district": "Yenişehir",
  "city": "Mersin",
  "address": "Hürriyet Mahallesi İsmet İnönü Caddesi No:300 Yenişehir / MERSİN",
  "latitude": 36.794601,
  "longitude": 34.598666,
  "locationStatus": "verified",
  "socketSummary": "2 soket · 2 DC · 60 kW",
  "sockets": [
    {
      "socketNo": "SKT/4006",
      "currentType": "DC",
      "socketType": "DC_CCS",
      "powerKw": 60
    }
  ],
  "links": {
    "googleMaps": "https://www.google.com/maps/search/?api=1&query=36.794601%2C34.598666"
  }
}
```

## Location Status

- `verified`: panelde veya güvenilir kaynakla doğrulanmış koordinat.
- `unverified`: kullanılabilir ama henüz doğrulanmamış koordinat.
- `missing`: koordinat yok.
- `rejected`: bilinen şekilde hatalı, haritada gösterilmemeli.

## API Endpoints

### `GET /api/v1/stations`

Liste ve harita endpointidir.

Response:

```json
{
  "data": [
    {
      "stationNo": "ŞRJ/2188",
      "name": "Mersin Migros",
      "brand": "zes",
      "district": "Yenişehir",
      "latitude": 36.794601,
      "longitude": 34.598666,
      "locationStatus": "verified"
    }
  ],
  "meta": {
    "total": 209,
    "verified": 32,
    "unverified": 177,
    "missing": 0
  }
}
```

### `GET /api/v1/stations/{stationNo}`

Detay endpointidir.

### `POST /api/v1/routes`

Rota hesaplama endpointidir. Mobil ve web OSRM/Google gibi servisleri doğrudan çağırmaz; bu endpoint proxy gibi davranır.

### `GET /api/v1/health`

Canlılık kontrolüdür.

```json
{
  "ok": true,
  "version": "1.0.0"
}
```

### `GET /api/v1/events`

LimonUp etkinlik sekmesinin okuyacağı public endpointtir. Etkinlik.io verisi backend tarafından senkronize edilir.

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "provider": "etkinlik.io",
    "enabled": false,
    "city": "Mersin",
    "lastSyncedAt": null
  }
}
```

### `GET /api/v1/taxi/tariff`

Taksi hesaplama modülünün güncel tarifeyi okuduğu public endpointtir.

```json
{
  "tariff": {
    "openingFee": 50,
    "perKmFee": 60,
    "minimumFare": 230,
    "roundTo": 1,
    "notice": "Tahmini sonuçtur, kesin ücret değildir.",
    "updatedAt": "2026-07-20T00:00:00+03:00"
  }
}
```

### `POST /api/v1/taxi/estimate`

Kilometre değerine göre tahmini taksi ücretini hesaplar.

Body:

```json
{
  "distanceKm": 8.5
}
```

Response:

```json
{
  "estimate": {
    "distanceKm": 8.5,
    "fare": {
      "amount": 560,
      "openingFee": 50,
      "distanceFee": 510,
      "minimumApplied": false
    }
  }
}
```

## Admin Endpoints

Admin endpointleri token gerektirir.
Canlı panel yolu `/admin` olarak ayrılır; mobil uygulama bu endpointleri kullanmaz.

### `GET /api/admin/stations`

Panel liste ekranı.

### `POST /api/admin/stations`

Yeni istasyon.

### `PATCH /api/admin/stations/{id}`

İstasyon güncelleme.

### `POST /api/admin/stations/{id}/location`

Koordinat ve doğrulama durumu güncelleme.

Body:

```json
{
  "latitude": 36.794601,
  "longitude": 34.598666,
  "locationStatus": "verified",
  "verificationSource": "Google Maps",
  "verificationNote": "Migros Yenişehir işletme noktası"
}
```

### `POST /api/admin/imports`

Excel/CSV/PDF içe aktarma önizlemesi.

### `POST /api/admin/imports/{id}/apply`

Önizlenen değişiklikleri uygular.

### `GET /api/admin/events/settings`

Etkinlik.io entegrasyon ayarını döndürür.

### `PUT /api/admin/events/settings`

Etkinlik.io entegrasyon ayarını günceller.

### `POST /api/admin/events/sync`

Server tarafındaki `ETKINLIK_IO_TOKEN` ile etkinlikleri çeker ve yerel/canlı veri kaynağına yazar.

### `GET /api/admin/taxi/tariff`

Panelde taksi tarifesini getirir.

### `PUT /api/admin/taxi/tariff`

Açılış, kilometre, kısa mesafe, yuvarlama ve kullanıcı uyarısı metnini günceller.

## Yetki Rolleri

- `viewer`: sadece panel görüntüler.
- `editor`: istasyon ve soket düzenler.
- `admin`: kullanıcı, import ve yayın işlemlerini yönetir.

## Mobil Cache

Mobil uygulama `GET /api/v1/stations` sonucunu kısa süreli cacheleyebilir. API yanıtına ileride `etag` veya `updatedAt` eklenmelidir.
