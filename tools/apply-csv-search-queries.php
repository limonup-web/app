<?php
declare(strict_types=1);

$stationsFile = $argv[1] ?? __DIR__ . '/../data/stations.json';
$csvFile = $argv[2] ?? __DIR__ . '/../data/google_mymaps_mersin_sarj_istasyonlari_duzeltilmis.csv';

$payload = json_decode(file_get_contents($stationsFile), true, 512, JSON_THROW_ON_ERROR);
$csv = fopen($csvFile, 'rb');
if (!$csv) {
    fwrite(STDERR, "CSV okunamadı\n");
    exit(1);
}

$headers = fgetcsv($csv);
if ($headers === false) {
    fwrite(STDERR, "CSV başlığı okunamadı\n");
    exit(1);
}
$headers = array_map(static fn(string $header): string => trim($header, "\xEF\xBB\xBF \t\n\r\0\x0B"), $headers);

$rowsByStationNo = [];
while (($row = fgetcsv($csv)) !== false) {
    $item = [];
    foreach ($headers as $index => $header) {
        $item[$header] = $row[$index] ?? '';
    }
    $stationNo = trim((string)($item['İstasyon No'] ?? ''));
    if ($stationNo !== '') {
        $rowsByStationNo[$stationNo] = $item;
    }
}
fclose($csv);

$applied = 0;
$missing = [];
foreach ($payload['stations'] as &$station) {
    $stationNo = (string)($station['stationNo'] ?? '');
    if (!isset($rowsByStationNo[$stationNo])) {
        $missing[] = $stationNo;
        continue;
    }

    $csvRow = $rowsByStationNo[$stationNo];
    $locationQuery = trim((string)($csvRow['Google Konum Araması'] ?? $csvRow['Konum'] ?? ''));
    $station['googleSearchQuery'] = $locationQuery;
    $station['myMapsLocationQuery'] = trim((string)($csvRow['Konum'] ?? $locationQuery));
    $station['normalizedAddress'] = trim((string)($csvRow['Adres'] ?? ''));
    $station['mapTitle'] = trim((string)($csvRow['Başlık'] ?? $station['name']));
    $applied++;
}
unset($station);

file_put_contents($stationsFile, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

echo "applied={$applied}\n";
echo "missing=" . count($missing) . "\n";
