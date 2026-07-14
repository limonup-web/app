<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
header('Permissions-Policy: microphone=(), camera=()');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed'], JSON_UNESCAPED_UNICODE);
    exit;
}

$from = parsePoint((string)($_GET['from'] ?? ''));
$to = parsePoint((string)($_GET['to'] ?? ''));

if ($from === null || $to === null) {
    http_response_code(422);
    echo json_encode(['error' => 'invalid_coordinates'], JSON_UNESCAPED_UNICODE);
    exit;
}

$routeUrl = sprintf(
    'http://router.project-osrm.org/route/v1/driving/%F,%F;%F,%F?overview=full&geometries=geojson&alternatives=false&steps=false',
    $from['lng'],
    $from['lat'],
    $to['lng'],
    $to['lat']
);

$context = stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 12,
        'header' => "Accept: application/json\r\nUser-Agent: mersin-charge-map/1.0\r\n",
    ],
]);

$raw = @file_get_contents($routeUrl, false, $context);
if ($raw === false) {
    http_response_code(502);
    echo json_encode(['error' => 'route_provider_unavailable'], JSON_UNESCAPED_UNICODE);
    exit;
}

$payload = json_decode($raw, true);
$route = $payload['routes'][0] ?? null;
if (!is_array($route) || !isset($route['geometry']['coordinates'], $route['distance'], $route['duration'])) {
    http_response_code(502);
    echo json_encode(['error' => 'route_not_found'], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'distance' => (float)$route['distance'],
    'duration' => (float)$route['duration'],
    'geometry' => [
        'type' => 'LineString',
        'coordinates' => $route['geometry']['coordinates'],
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function parsePoint(string $value): ?array
{
    if (!preg_match('/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/', $value, $match)) {
        return null;
    }

    $lat = (float)$match[1];
    $lng = (float)$match[2];

    if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
        return null;
    }

    return ['lat' => $lat, 'lng' => $lng];
}
