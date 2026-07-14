<?php
declare(strict_types=1);

$stationsFile = $argv[1] ?? __DIR__ . '/../data/stations.json';
$comparisonFile = $argv[2] ?? __DIR__ . '/../data/mymaps-comparison.json';

$payload = json_decode(file_get_contents($stationsFile), true, 512, JSON_THROW_ON_ERROR);
$comparison = json_decode(file_get_contents($comparisonFile), true, 512, JSON_THROW_ON_ERROR);
$coordinatesByStationNo = [];

foreach ($comparison['coordinateMatches'] ?? [] as $match) {
    $stationNo = (string)($match['stationNo'] ?? '');
    $coords = $match['myMapsCoordinates'] ?? null;
    if ($stationNo !== '' && is_array($coords)) {
        $coordinatesByStationNo[$stationNo] = [
            'latitude' => (float)$coords['latitude'],
            'longitude' => (float)$coords['longitude'],
            'myMapsName' => (string)($match['myMapsName'] ?? ''),
        ];
    }
}

$applied = 0;
foreach ($payload['stations'] as &$station) {
    $stationNo = (string)($station['stationNo'] ?? '');
    if (!isset($coordinatesByStationNo[$stationNo])) {
        continue;
    }

    $coords = $coordinatesByStationNo[$stationNo];
    $station['latitude'] = round($coords['latitude'], 7);
    $station['longitude'] = round($coords['longitude'], 7);
    $station['geocodeQuality'] = 'manual';
    $station['geocodeScore'] = 100;
    $station['geocodeProvider'] = 'Google My Maps';
    $station['geocodeQuery'] = $coords['myMapsName'];
    $station['geocodeDisplayName'] = $coords['myMapsName'];
    $station['geocodedAt'] = gmdate('c');
    $applied++;
}
unset($station);

$payload['geocoding'] = [
    'provider' => 'Google My Maps + OpenStreetMap tiles',
    'matched' => count(array_filter($payload['stations'], static fn(array $station): bool => is_numeric($station['latitude'] ?? null))),
    'unmatched' => count(array_filter($payload['stations'], static fn(array $station): bool => !is_numeric($station['latitude'] ?? null))),
    'updatedAt' => gmdate('c'),
];

file_put_contents($stationsFile, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

echo "applied={$applied}\n";
echo "matched={$payload['geocoding']['matched']}\n";
echo "unmatched={$payload['geocoding']['unmatched']}\n";
