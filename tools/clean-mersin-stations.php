<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$stationsFile = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'stations.json';
$excludedFile = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'excluded-stations.json';

$payload = json_decode(file_get_contents($stationsFile), true, 512, JSON_THROW_ON_ERROR);
$excluded = [];
$cleanStations = [];
$now = gmdate('c');

foreach ($payload['stations'] as $station) {
    $name = (string)($station['name'] ?? '');
    if (mb_stripos($name, 'Diyarbakır', 0, 'UTF-8') !== false || mb_stripos($name, 'DİYARBAKIR', 0, 'UTF-8') !== false) {
        $station['excludedReason'] = 'Mersin datasına karışan Diyarbakır istasyonu';
        $station['excludedAt'] = $now;
        $excluded[] = $station;
        continue;
    }

    if (($station['stationNo'] ?? '') === 'ŞRJ/20587') {
        $station['latitude'] = 36.9168058;
        $station['longitude'] = 34.6243978;
        $station['geocodeQuality'] = 'deduplicated-manual';
        $station['geocodeScore'] = 100;
        $station['geocodeProvider'] = 'Matched duplicate BN Hotel Mersin coordinate';
        $station['geocodeQuery'] = 'BN Hotel Thermal & SPA Iğıdır Mahallesi Akdeniz Mersin';
        $station['geocodeDisplayName'] = 'BN Hotel Thermal & Wellness';
        $station['geocodedAt'] = $now;
    }

    $cleanStations[] = $station;
}

$payload['stations'] = array_values($cleanStations);
$payload['stationCount'] = count($payload['stations']);
$payload['cleaning'] = [
    'updatedAt' => $now,
    'excludedCount' => count($excluded),
    'rules' => [
        'Removed stations whose name contains Diyarbakır',
        'Corrected ŞRJ/20587 to known BN Hotel Mersin duplicate coordinates',
    ],
];

file_put_contents(
    $stationsFile,
    json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL
);

file_put_contents(
    $excludedFile,
    json_encode([
        'generatedAt' => $now,
        'excludedCount' => count($excluded),
        'stations' => $excluded,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL
);

echo 'Remaining stations: ' . count($payload['stations']) . PHP_EOL;
echo 'Excluded stations: ' . count($excluded) . PHP_EOL;
