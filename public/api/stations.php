<?php
declare(strict_types=1);

$allowedOrigin = getenv('ALLOWED_ORIGIN') ?: '';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');

if ($allowedOrigin !== '' && hash_equals($allowedOrigin, $origin)) {
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
    header('Vary: Origin');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed'], JSON_UNESCAPED_UNICODE);
    exit;
}

$dataFile = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'stations.json';
if (!is_file($dataFile)) {
    http_response_code(503);
    echo json_encode(['error' => 'station_data_not_ready'], JSON_UNESCAPED_UNICODE);
    exit;
}

$raw = file_get_contents($dataFile);
$etag = '"' . hash('sha256', $raw) . '"';
header('ETag: ' . $etag);
header('Cache-Control: public, max-age=300, stale-while-revalidate=86400');

if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}

$payload = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
$district = trim((string)($_GET['district'] ?? ''));
$query = mb_strtolower(trim((string)($_GET['q'] ?? '')), 'UTF-8');

$stations = array_values(array_filter($payload['stations'], static function (array $station) use ($district, $query): bool {
    if ($district !== '' && ($station['district'] ?? '') !== $district) {
        return false;
    }

    if ($query === '') {
        return true;
    }

    $haystack = mb_strtolower(implode(' ', [
        $station['name'] ?? '',
        $station['brand'] ?? '',
        $station['address'] ?? '',
        $station['stationNo'] ?? '',
        $station['district'] ?? '',
    ]), 'UTF-8');

    return mb_strpos($haystack, $query, 0, 'UTF-8') !== false;
}));

$districts = [];
foreach ($payload['stations'] as $station) {
    $name = (string)($station['district'] ?? 'Bilinmiyor');
    $districts[$name] = ($districts[$name] ?? 0) + 1;
}
ksort($districts, SORT_LOCALE_STRING);

echo json_encode([
    'meta' => [
        'city' => $payload['city'] ?? 'Mersin',
        'generatedAt' => $payload['generatedAt'] ?? null,
        'totalStations' => $payload['stationCount'] ?? count($payload['stations']),
        'returnedStations' => count($stations),
    ],
    'districts' => array_map(
        static fn(string $name, int $count): array => ['name' => $name, 'count' => $count],
        array_keys($districts),
        array_values($districts)
    ),
    'stations' => $stations,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
