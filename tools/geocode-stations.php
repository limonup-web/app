<?php
declare(strict_types=1);

$dataFile = $argv[1] ?? __DIR__ . '/../data/stations.json';
$cacheFile = $argv[2] ?? __DIR__ . '/../data/geocode-cache.json';
$limit = isset($argv[3]) ? max(1, (int)$argv[3]) : 9999;

$payload = json_decode(file_get_contents($dataFile), true, 512, JSON_THROW_ON_ERROR);
$cache = is_file($cacheFile)
    ? json_decode(file_get_contents($cacheFile), true, 512, JSON_THROW_ON_ERROR)
    : [];

$processed = 0;
$matched = 0;
$skipped = 0;

foreach ($payload['stations'] as &$station) {
    if ($processed >= $limit) {
        break;
    }

    if (is_numeric($station['latitude'] ?? null) && is_numeric($station['longitude'] ?? null)) {
        $skipped++;
        continue;
    }

    $queries = buildQueries($station);
    $best = null;

    foreach ($queries as $query) {
        $key = sha1(mb_strtolower($query, 'UTF-8'));
        $needsFetch = !array_key_exists($key, $cache) || (($cache[$key]['error'] ?? null) !== null);
        if ($needsFetch) {
            $cache[$key] = geocode($query);
            writeJson($cacheFile, $cache);
            usleep(1100000);
        }

        $candidate = pickCandidate($cache[$key], $station, $query);
        if ($candidate !== null && ($best === null || $candidate['score'] > $best['score'])) {
            $best = $candidate;
        }

        if ($best !== null && $best['score'] >= 90) {
            break;
        }
    }

    $processed++;

    if ($best !== null && $best['score'] >= 72) {
        $station['latitude'] = round((float)$best['lat'], 7);
        $station['longitude'] = round((float)$best['lon'], 7);
        $station['geocodeQuality'] = qualityFromScore($best['score']);
        $station['geocodeScore'] = $best['score'];
        $station['geocodeQuery'] = $best['query'];
        $station['geocodeDisplayName'] = $best['display_name'] ?? '';
        $station['geocodeProvider'] = 'OpenStreetMap Nominatim';
        $station['geocodedAt'] = gmdate('c');
        $matched++;
    } else {
        $station['geocodeQuality'] = 'unmatched';
        $station['geocodeScore'] = $best['score'] ?? 0;
        $station['geocodeQuery'] = $best['query'] ?? $queries[0] ?? '';
        $station['geocodeDisplayName'] = $best['display_name'] ?? '';
    }
}
unset($station);

$payload['geocoding'] = [
    'provider' => 'OpenStreetMap Nominatim',
    'matched' => count(array_filter($payload['stations'], static fn(array $station): bool => is_numeric($station['latitude'] ?? null))),
    'unmatched' => count(array_filter($payload['stations'], static fn(array $station): bool => !is_numeric($station['latitude'] ?? null))),
    'updatedAt' => gmdate('c'),
];

writeJson($dataFile, $payload);

echo "processed={$processed}\n";
echo "matched={$matched}\n";
echo "skipped={$skipped}\n";
echo "totalMatched={$payload['geocoding']['matched']}\n";
echo "totalUnmatched={$payload['geocoding']['unmatched']}\n";

function buildQueries(array $station): array
{
    $address = normalizeAddress((string)$station['address']);
    $name = normalizeAddress((string)$station['name']);
    $district = normalizeAddress((string)$station['district']);
    $googleSearchQuery = normalizeAddress((string)($station['googleSearchQuery'] ?? ''));

    $queries = [
        $googleSearchQuery,
        trim($name . ', ' . $address . ', Türkiye'),
        trim($address . ', Türkiye'),
    ];

    $simplified = preg_replace('/\s+No[:\s]*[A-Z0-9\/\-.]+/iu', '', $address);
    if ($simplified !== null && $simplified !== $address) {
        $queries[] = trim($simplified . ', Türkiye');
    }

    if (preg_match('/([\p{L}\d\.\s]+Mahallesi).*?([\p{L}\d\.\s]+(?:Sokağı|Sokak|Caddesi|Cadde|Bulvarı|Bulvar))/iu', $address, $matches)) {
        $queries[] = trim($matches[1] . ' ' . $matches[2] . ', ' . $district . ', Mersin, Türkiye');
    }

    $queries[] = trim($name . ', ' . $district . ', Mersin, Türkiye');

    return array_values(array_unique(array_filter($queries)));
}

function normalizeAddress(string $value): string
{
    $value = str_replace([' / ', '/'], ', ', $value);
    $value = str_ireplace([' MERSİN', ' Mersin'], ' Mersin', $value);
    $value = preg_replace('/\s+/', ' ', $value) ?? $value;
    return trim($value, " \t\n\r\0\x0B,");
}

function geocode(string $query): array
{
    $url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=tr&addressdetails=1&q=' . rawurlencode($query);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_USERAGENT => 'MersinSarjIstasyonlari/0.1 (local data preparation; https://localhost.invalid/mersin-sarj-istasyonlari)',
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Referer: https://localhost.invalid/mersin-sarj-istasyonlari',
        ],
    ]);

    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($body === false || $status < 200 || $status >= 300) {
        return ['error' => $error ?: 'http_' . $status, 'results' => []];
    }

    $decoded = json_decode($body, true);
    return ['error' => null, 'results' => is_array($decoded) ? $decoded : []];
}

function pickCandidate(array $response, array $station, string $query): ?array
{
    $results = $response['results'] ?? [];
    if (!is_array($results) || $results === []) {
        return null;
    }

    $best = null;
    foreach ($results as $result) {
        $lat = (float)($result['lat'] ?? 0);
        $lon = (float)($result['lon'] ?? 0);
        if ($lat < 35.6 || $lat > 37.5 || $lon < 32.4 || $lon > 35.4) {
            continue;
        }

        $display = mb_strtolower((string)($result['display_name'] ?? ''), 'UTF-8');
        $address = $result['address'] ?? [];
        $score = 28;
        $hasDetail = false;

        if (str_contains($display, mb_strtolower((string)$station['district'], 'UTF-8'))) {
            $score += 12;
        }
        if (str_contains($display, 'mersin')) {
            $score += 6;
        }

        $stationNameWords = importantWords((string)$station['name']);
        foreach ($stationNameWords as $word) {
            if (str_contains($display, $word)) {
                $score += 6;
                $hasDetail = true;
            }
        }

        $stationAddressWords = importantWords((string)$station['address']);
        foreach (array_slice($stationAddressWords, 0, 7) as $word) {
            if (str_contains($display, $word)) {
                $score += 8;
                $hasDetail = true;
            }
        }

        $placeType = (string)($result['type'] ?? '');
        if (in_array($placeType, ['charging_station', 'fuel', 'mall', 'hotel', 'supermarket', 'hospital', 'parking'], true)) {
            $score += 10;
            $hasDetail = true;
        }
        if (($address['road'] ?? '') !== '' || ($address['neighbourhood'] ?? '') !== '' || ($address['suburb'] ?? '') !== '') {
            $score += 12;
            $hasDetail = true;
        }

        if (!$hasDetail) {
            $score = min($score, 54);
        }

        $result['score'] = min(100, $score);
        $result['query'] = $query;

        if ($best === null || $result['score'] > $best['score']) {
            $best = $result;
        }
    }

    return $best;
}

function importantWords(string $value): array
{
    $value = mb_strtolower($value, 'UTF-8');
    preg_match_all('/[\p{L}\d]{4,}/u', $value, $matches);
    $stop = ['mahallesi', 'sokağı', 'sokak', 'caddesi', 'cadde', 'mersin', 'merkez', 'no'];
    return array_values(array_filter(array_unique($matches[0] ?? []), static fn(string $word): bool => !in_array($word, $stop, true)));
}

function qualityFromScore(int $score): string
{
    if ($score >= 90) {
        return 'high';
    }
    if ($score >= 76) {
        return 'medium';
    }
    return 'low';
}

function writeJson(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
