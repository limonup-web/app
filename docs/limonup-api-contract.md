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

## Admin Endpoints

Admin endpointleri token gerektirir.

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

## Yetki Rolleri

- `viewer`: sadece panel görüntüler.
- `editor`: istasyon ve soket düzenler.
- `admin`: kullanıcı, import ve yayın işlemlerini yönetir.

## Mobil Cache

Mobil uygulama `GET /api/v1/stations` sonucunu kısa süreli cacheleyebilir. API yanıtına ileride `etag` veya `updatedAt` eklenmelidir.
