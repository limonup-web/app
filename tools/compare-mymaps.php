<?php
declare(strict_types=1);

$stationsFile = $argv[1] ?? __DIR__ . '/../data/stations.json';
$kmlFile = $argv[2] ?? __DIR__ . '/../data/mymaps.kml';
$outFile = $argv[3] ?? __DIR__ . '/../data/mymaps-comparison.json';

$stationsPayload = json_decode(file_get_contents($stationsFile), true, 512, JSON_THROW_ON_ERROR);
$kml = simplexml_load_file($kmlFile);
if (!$kml) {
    fwrite(STDERR, "KML okunamadı\n");
    exit(1);
}

$kml->registerXPathNamespace('k', 'http://www.opengis.net/kml/2.2');
$placemarks = [];

foreach ($kml->xpath('//k:Placemark') as $placemark) {
    $placemark->registerXPathNamespace('k', 'http://www.opengis.net/kml/2.2');
    $data = [];
    foreach ($placemark->xpath('.//k:ExtendedData/k:Data') as $item) {
        $name = (string)$item['name'];
        $value = trim((string)$item->value);
        if ($name !== '') {
            $data[$name] = $value;
        }
    }

    $coordsNode = $placemark->xpath('.//k:Point/k:coordinates')[0] ?? null;
    $coords = null;
    if ($coordsNode !== null) {
        $parts = array_map('trim', explode(',', trim((string)$coordsNode)));
        if (count($parts) >= 2) {
            $coords = [
                'longitude' => (float)$parts[0],
                'latitude' => (float)$parts[1],
            ];
        }
    }

    $placemarks[] = [
        'name' => trim((string)$placemark->name),
        'address' => $data['Adres'] ?? trim((string)$placemark->address),
        'stationNo' => $data['İstasyon No'] ?? '',
        'district' => $data['İlçe'] ?? '',
        'brand' => $data['Marka'] ?? '',
        'hasCoordinates' => $coords !== null,
        'coordinates' => $coords,
    ];
}

$byStationNo = [];
$byName = [];
foreach ($stationsPayload['stations'] as $station) {
    if (($station['stationNo'] ?? '') !== '') {
        $byStationNo[$station['stationNo']] = $station;
    }
    $byName[normalizeName((string)$station['name'])][] = $station;
}

$matched = [];
$unmatchedMyMaps = [];
$coordinateMatches = [];

foreach ($placemarks as $place) {
    $station = null;
    $matchType = null;
    if ($place['stationNo'] !== '' && isset($byStationNo[$place['stationNo']])) {
        $station = $byStationNo[$place['stationNo']];
        $matchType = 'stationNo';
    } else {
        $key = normalizeName($place['name']);
        if (isset($byName[$key]) && count($byName[$key]) === 1) {
            $station = $byName[$key][0];
            $matchType = 'name';
        }
    }

    if ($station === null) {
        $unmatchedMyMaps[] = $place;
        continue;
    }

    $row = [
        'sequence' => $station['sequence'],
        'stationNo' => $station['stationNo'],
        'name' => $station['name'],
        'district' => $station['district'],
        'matchType' => $matchType,
        'myMapsName' => $place['name'],
        'myMapsHasCoordinates' => $place['hasCoordinates'],
        'myMapsCoordinates' => $place['coordinates'],
    ];
    $matched[] = $row;
    if ($place['hasCoordinates']) {
        $coordinateMatches[] = $row;
    }
}

$stationNosInMap = array_filter(array_column($matched, 'stationNo'));
$missingFromMap = array_values(array_filter($stationsPayload['stations'], static function (array $station) use ($stationNosInMap): bool {
    return !in_array($station['stationNo'], $stationNosInMap, true);
}));

$result = [
    'summary' => [
        'stationsTotal' => count($stationsPayload['stations']),
        'myMapsPlacemarks' => count($placemarks),
        'myMapsWithCoordinates' => count(array_filter($placemarks, static fn(array $place): bool => $place['hasCoordinates'])),
        'matchedPlacemarks' => count($matched),
        'matchedCoordinatePlacemarks' => count($coordinateMatches),
        'unmatchedMyMapsPlacemarks' => count($unmatchedMyMaps),
        'stationsMissingFromMatchedMap' => count($missingFromMap),
    ],
    'coordinateMatches' => $coordinateMatches,
    'unmatchedMyMaps' => $unmatchedMyMaps,
    'missingFromMap' => array_map(static fn(array $station): array => [
        'sequence' => $station['sequence'],
        'stationNo' => $station['stationNo'],
        'name' => $station['name'],
        'district' => $station['district'],
    ], $missingFromMap),
];

file_put_contents($outFile, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

foreach ($result['summary'] as $key => $value) {
    echo $key . '=' . $value . PHP_EOL;
}

function normalizeName(string $value): string
{
    $value = strtr($value, [
        'İ' => 'I', 'I' => 'I', 'ı' => 'i',
        'Ğ' => 'G', 'ğ' => 'g',
        'Ü' => 'U', 'ü' => 'u',
        'Ş' => 'S', 'ş' => 's',
        'Ö' => 'O', 'ö' => 'o',
        'Ç' => 'C', 'ç' => 'c',
    ]);
    $value = mb_strtolower($value, 'UTF-8');
    $value = preg_replace('/[^a-z0-9]+/u', ' ', $value) ?? $value;
    $value = preg_replace('/\s+/', ' ', $value) ?? $value;
    return trim($value);
}
