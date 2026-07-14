<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$viewerFile = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'mymaps-viewer.html';
$stationsFile = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'stations.json';

if (!is_file($viewerFile)) {
    fwrite(STDERR, "Missing viewer file: {$viewerFile}\n");
    exit(1);
}

if (!is_file($stationsFile)) {
    fwrite(STDERR, "Missing stations file: {$stationsFile}\n");
    exit(1);
}

$html = file_get_contents($viewerFile);
if ($html === false || !preg_match('/var _pageData = "(.*?)";/s', $html, $match)) {
    fwrite(STDERR, "Could not find _pageData in viewer HTML.\n");
    exit(1);
}

$pageData = decodeJsString($match[1]);
$coordinatesByStationNo = extractCoordinatesByStationNo($pageData);
$coordinateSources = array_fill_keys(array_keys($coordinatesByStationNo), 'Google My Maps viewer');

$manualOverrides = [
    '12118' => [
        'latitude' => 36.645161,
        'longitude' => 33.4362989,
        'provider' => 'OpenStreetMap Nominatim',
        'query' => 'Çınaraltı Parkı Mut Mersin',
    ],
];

foreach ($manualOverrides as $stationNo => $override) {
    $coordinatesByStationNo[$stationNo] = [
        'latitude' => $override['latitude'],
        'longitude' => $override['longitude'],
    ];
    $coordinateSources[$stationNo] = $override['provider'];
}

if (count($coordinatesByStationNo) < 190) {
    fwrite(STDERR, "Only found " . count($coordinatesByStationNo) . " station coordinates; refusing to apply partial data.\n");
    exit(1);
}

$payload = json_decode(file_get_contents($stationsFile), true, 512, JSON_THROW_ON_ERROR);
$updated = 0;
$missing = [];
$withCoordinates = 0;
$now = gmdate('c');

foreach ($payload['stations'] as &$station) {
    $key = stationNumberKey((string)($station['stationNo'] ?? ''));
    if ($key === null || !isset($coordinatesByStationNo[$key])) {
        if (hasCoordinates($station)) {
            $withCoordinates++;
        } else {
            $missing[] = [
                'stationNo' => $station['stationNo'] ?? '',
                'name' => $station['name'] ?? '',
            ];
        }
        continue;
    }

    $coords = $coordinatesByStationNo[$key];
    $station['latitude'] = $coords['latitude'];
    $station['longitude'] = $coords['longitude'];
    $station['geocodeQuality'] = ($coordinateSources[$key] ?? '') === 'Google My Maps viewer'
        ? 'mymaps-viewer'
        : 'manual-verified';
    $station['geocodeScore'] = 100;
    $station['geocodeProvider'] = $coordinateSources[$key] ?? 'Google My Maps viewer';
    $station['geocodeQuery'] = $manualOverrides[$key]['query'] ?? $station['mapTitle'] ?? $station['name'] ?? $station['stationNo'] ?? '';
    $station['geocodeDisplayName'] = $station['mapTitle'] ?? $station['name'] ?? '';
    $station['geocodedAt'] = $now;
    $updated++;
    $withCoordinates++;
}
unset($station);

$payload['geocoding'] = [
    'provider' => 'Google My Maps viewer coordinates',
    'matched' => $withCoordinates,
    'unmatched' => count($missing),
    'updatedAt' => $now,
];

file_put_contents(
    $stationsFile,
    json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL
);

echo "Extracted coordinates: " . count($coordinatesByStationNo) . PHP_EOL;
echo "Updated stations: {$updated}" . PHP_EOL;
echo "Stations with coordinates: {$withCoordinates}" . PHP_EOL;
echo "Missing stations: " . count($missing) . PHP_EOL;

if ($missing !== []) {
    echo "First missing entries:" . PHP_EOL;
    foreach (array_slice($missing, 0, 10) as $entry) {
        echo "- {$entry['stationNo']} {$entry['name']}" . PHP_EOL;
    }
}

function decodeJsString(string $value): string
{
    $value = preg_replace_callback('/\\\\u([0-9a-fA-F]{4})/', static function (array $match): string {
        return mb_convert_encoding(pack('H*', $match[1]), 'UTF-8', 'UTF-16BE');
    }, $value);

    return stripcslashes($value);
}

/**
 * @return array<string, array{latitude: float, longitude: float}>
 */
function extractCoordinatesByStationNo(string $pageData): array
{
    $records = [];
    $number = '-?\d+(?:\.\d+)?';
    $pattern = '/\["[^"]+",\[\[\[(' . $number . '),(' . $number . ')\]\]\].*?\["(?:İstasyon No|Istasyon No)",\["([^"]*?\/\d+)"\],1\]/us';

    preg_match_all($pattern, $pageData, $matches, PREG_SET_ORDER);

    foreach ($matches as $match) {
        $key = stationNumberKey($match[3]);
        if ($key === null) {
            continue;
        }

        $records[$key] = [
            'latitude' => round((float)$match[1], 7),
            'longitude' => round((float)$match[2], 7),
        ];
    }

    return $records;
}

function stationNumberKey(string $stationNo): ?string
{
    return preg_match('/\/\s*(\d+)/u', $stationNo, $match) ? $match[1] : null;
}

function hasCoordinates(array $station): bool
{
    return isset($station['latitude'], $station['longitude'])
        && is_numeric($station['latitude'])
        && is_numeric($station['longitude']);
}
