# LimonUp Şarj İstasyonları Platform Planı

## Hedef

Mersin şarj istasyonları modülü, LimonUp web sitesi ve ilerideki mobil uygulama tarafından ortak kullanılan bir servis haline gelecek. Statik JSON dosyası geçici kaynak olarak kalabilir, fakat canlı kullanımda veri panelden yönetilecek ve tüm istemciler aynı API'den beslenecek.

## Önerilen Mimari

İlk canlı sürüm için önerilen yapı:

- Web: mevcut harita arayüzü, API'den okuyan public istemci.
- Admin panel: yetkili kullanıcıların istasyon ekleyip düzenlediği ayrı panel.
- API: web, mobil ve panelin ortak kullandığı sürümlü endpointler.
- Veritabanı: ilişkisel tablo yapısı. İstasyon, soket, doğrulama durumu ve değişiklik geçmişi ayrı tutulmalı.
- Harita: Leaflet/OpenStreetMap devam edebilir; Google Maps sadece dışa açma ve opsiyonel doğrulama linki olarak kullanılır.

Cloudflare D1 + Workers veya Supabase/Postgres bu iş için uygun iki yol. Mevcut site zaten Cloudflare/Sites hattında olduğu için D1 + Worker daha az platform değiştirir. Daha gelişmiş auth, dosya ve panel kolaylığı istenirse Supabase/Postgres daha rahat büyür.

## Veri Modeli

### stations

- `id`
- `station_no`
- `name`
- `brand`
- `network_operator`
- `station_operator`
- `service_type`
- `district`
- `city`
- `address`
- `normalized_address`
- `latitude`
- `longitude`
- `location_status`: `verified`, `unverified`, `missing`, `rejected`
- `verification_source`
- `verification_note`
- `google_maps_url`
- `is_active`
- `created_at`
- `updated_at`

### station_sockets

- `id`
- `station_id`
- `socket_no`
- `current_type`: `AC`, `DC`
- `socket_type`
- `power_kw`
- `created_at`
- `updated_at`

### station_audit_logs

- `id`
- `station_id`
- `action`: `create`, `update`, `delete`, `verify`, `import`
- `actor_id`
- `before_json`
- `after_json`
- `created_at`

### imports

- `id`
- `source_name`
- `source_type`: `xls`, `csv`, `pdf`, `manual`
- `status`: `draft`, `applied`, `failed`
- `summary_json`
- `created_by`
- `created_at`

## Public API

Base path önerisi: `/api/v1`

### `GET /api/v1/stations`

Web ve mobil liste/harita için.

Query:

- `district`
- `brand`
- `socket`
- `q`
- `lat`
- `lng`
- `radius_km`
- `location_status`: varsayılan `all`

Response:

```json
{
  "data": [],
  "meta": {
    "total": 209,
    "verified": 32,
    "unverified": 177
  }
}
```

### `GET /api/v1/stations/{station_no}`

Tek istasyon detay ekranı için.

### `GET /api/v1/districts`

İlçe filtreleri ve sayaçları için.

### `GET /api/v1/brands`

Firma filtreleri için.

### `POST /api/v1/routes`

İlk sürümde OSRM proxy olabilir. Mobilde API anahtarı veya harici servis detayı istemciye açılmaz.

Body:

```json
{
  "from": { "lat": 36.8, "lng": 34.6 },
  "to_station_no": "ŞRJ/2188"
}
```

## Admin API

Admin endpointleri public API'den ayrı tutulmalı.

Base path: `/api/admin`

- `POST /api/admin/login`
- `GET /api/admin/stations`
- `POST /api/admin/stations`
- `PATCH /api/admin/stations/{id}`
- `DELETE /api/admin/stations/{id}`
- `POST /api/admin/stations/{id}/verify-location`
- `POST /api/admin/imports`
- `POST /api/admin/imports/{id}/apply`
- `GET /api/admin/audit-logs`

## Admin Panel Özellikleri

İlk sürümde gerekenler:

- İstasyon listesi: arama, ilçe, firma, doğrulama durumu filtresi.
- İstasyon ekle/düzenle.
- Koordinat seçici: haritaya tıklayarak koordinat verme.
- Google Maps linkinden koordinat yapıştırma.
- `verified / unverified / missing` durumunu açık gösterme.
- Soket ekle/düzenle.
- Excel/CSV/PDF import önizleme.
- Değişiklik geçmişi.
- Yayına alma: draft değişiklikleri tek tek değil, kontrollü uygulama.

## Mobil Uygulama İçin

Mobil uygulama API'den sadece public endpointleri kullanmalı.

Gereken davranışlar:

- Konuma göre en yakın istasyon.
- Harita markerları.
- İstasyon detayı.
- Google Maps / Apple Maps ile harici navigasyon.
- Uygulama içi rota hesaplama opsiyonel.
- Offline cache: son indirilen istasyon listesi cihazda tutulabilir.

Güvenlik:

- Admin API sadece auth ile.
- Public API rate limitli.
- Mobil istemciye gizli anahtar gömülmez.
- Harici rota/geocoding anahtarları backend tarafında kalır.
- Admin işlemleri audit log'a yazılır.

## Canlıya Geçiş Sırası

1. Mevcut JSON veri `stations` ve `station_sockets` tablolarına migrate edilir.
2. Public API mevcut web arayüzüne bağlanır.
3. Admin panel ilk sürümü eklenir.
4. Import akışı eklenir.
5. Mobil uygulama aynı public API üstünden geliştirilir.
6. LimonUp ana site içinde bu modül route veya alt uygulama olarak bağlanır.

## Notlar

- Doğrulanmış ve doğrulanmamış koordinatlar aynı haritada görünebilir, fakat veri durumu ayrı kalmalı.
- Yanlış pin şikayetlerinde panel üzerinden koordinat düzeltilmeli, dosya elle düzenlenmemeli.
- Her koordinat değişikliği kimin, ne zaman, hangi kaynakla değiştirdiği bilgisiyle saklanmalı.
