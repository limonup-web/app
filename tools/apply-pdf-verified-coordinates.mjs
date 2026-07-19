import { readFile, writeFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));
const rowsFile = args.rows || "data/pdf-verified-coordinate-rows.json";
const dataFile = args.data || "data/stations.json";
const publicFile = args.public || "public/data/stations.json";
const reportFile = args.report || "data/pdf-coordinate-apply-report.json";
const apply = Boolean(args.apply);
const replaceMissing = Boolean(args.replaceMissing);

const verifiedRows = JSON.parse(await readFile(rowsFile, "utf8"));
const data = JSON.parse(await readFile(dataFile, "utf8"));
const publicData = JSON.parse(await readFile(publicFile, "utf8"));
const publicByNo = new Map(publicData.stations.map((station) => [station.stationNo, station]));
const generatedAt = new Date().toISOString();

const report = {
  generatedAt,
  source: "mersin_sarj_istasyonlari_tiklanabilir.pdf",
  applied: apply,
  replaceMissing,
  results: [],
};
const verifiedStationNumbers = new Set(verifiedRows.map((row) => row.stationNo).filter(Boolean));

for (const row of verifiedRows) {
  const stationNo = row.stationNo || "";
  const station = data.stations.find((item) => item.stationNo === stationNo);
  const result = {
    rowName: row.name,
    stationNo,
    matched: Boolean(station),
    latitude: row.latitude,
    longitude: row.longitude,
    previous: station ? {
      name: station.name,
      latitude: station.latitude,
      longitude: station.longitude,
      quality: station.geocodeQuality || "",
      provider: station.geocodeProvider || "",
    } : null,
    distanceFromPreviousKm: station ? distanceKm(
      { lat: Number(station.latitude), lng: Number(station.longitude) },
      { lat: row.latitude, lng: row.longitude },
    ) : null,
  };

  report.results.push(result);

  if (apply && station) {
    applyRow(station, row, generatedAt);
    const publicStation = publicByNo.get(station.stationNo);
    if (publicStation) applyRow(publicStation, row, generatedAt);
  }
}

if (apply && replaceMissing) {
  clearMissingCoordinates(data.stations, verifiedStationNumbers, generatedAt);
  clearMissingCoordinates(publicData.stations, verifiedStationNumbers, generatedAt);
}

report.matchedCount = report.results.filter((item) => item.matched).length;
report.unmatchedCount = report.results.filter((item) => !item.matched).length;
report.clearedCount = apply && replaceMissing
  ? data.stations.filter((station) => !verifiedStationNumbers.has(station.stationNo)).length
  : 0;

await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
if (apply) {
  updateGeocodingMeta(data, generatedAt);
  updateGeocodingMeta(publicData, generatedAt);
  await writeJson(dataFile, data);
  await writeJson(publicFile, publicData);
}

console.log(`rows=${verifiedRows.length}`);
console.log(`matched=${report.matchedCount}`);
console.log(`unmatched=${report.unmatchedCount}`);
console.log(`applied=${apply ? report.matchedCount : 0}`);
console.log(`cleared=${report.clearedCount}`);
console.log(`report=${reportFile}`);

function applyRow(station, row, timestamp) {
  station.latitude = row.latitude;
  station.longitude = row.longitude;
  station.geocodeQuality = "pdf-verified";
  station.geocodeScore = 100;
  station.geocodeProvider = row.sources || "Doğrulama raporu";
  station.geocodeQuery = row.name;
  station.geocodeDisplayName = row.name;
  station.geocodedAt = timestamp;
}

function clearMissingCoordinates(stations, stationNumbers, timestamp) {
  for (const station of stations) {
    if (stationNumbers.has(station.stationNo)) continue;
    station.latitude = null;
    station.longitude = null;
    station.geocodeQuality = "not-pdf-verified";
    station.geocodeScore = 0;
    station.geocodeProvider = "mersin_sarj_istasyonlari_tiklanabilir.pdf";
    station.geocodeQuery = station.name;
    station.geocodeDisplayName = "";
    station.geocodedAt = timestamp;
  }
}

function updateGeocodingMeta(payload, timestamp) {
  const stations = payload.stations || [];
  payload.geocoding = {
    provider: "mersin_sarj_istasyonlari_tiklanabilir.pdf",
    matched: stations.filter(hasCoordinates).length,
    unmatched: stations.filter((station) => !hasCoordinates(station)).length,
    updatedAt: timestamp,
  };
}

function hasCoordinates(station) {
  return station.latitude !== null
    && station.longitude !== null
    && station.latitude !== ""
    && station.longitude !== ""
    && Number.isFinite(Number(station.latitude))
    && Number.isFinite(Number(station.longitude));
}

function distanceKm(from, to) {
  if (!Number.isFinite(from.lat) || !Number.isFinite(from.lng)) return null;
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000) / 1000;
}

function toRadians(value) {
  return value * Math.PI / 180;
}

async function writeJson(file, payload) {
  await writeFile(file, `${JSON.stringify(payload, null, 4)}\n`);
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [key, rawValue] = value.slice(2).split("=");
    parsed[toCamel(key)] = rawValue ?? true;
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
