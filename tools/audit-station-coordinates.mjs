import { readFile, writeFile } from "node:fs/promises";

const inputFile = process.argv[2] || "data/stations.json";
const outputFile = process.argv[3] || "data/coordinate-audit.json";

const districtBounds = {
  Akdeniz: [36.68, 37.05, 34.52, 35.05],
  Anamur: [35.85, 36.35, 32.55, 33.15],
  Aydıncık: [36.05, 36.35, 33.15, 33.45],
  Bozyazı: [35.95, 36.35, 32.85, 33.25],
  Çamlıyayla: [37.05, 37.35, 34.45, 34.95],
  Erdemli: [36.45, 37.05, 33.85, 34.45],
  Gülnar: [36.15, 36.85, 33.0, 33.85],
  Mezitli: [36.65, 36.9, 34.4, 34.62],
  Mut: [36.35, 37.2, 33.05, 34.1],
  Silifke: [36.15, 36.75, 33.45, 34.2],
  Tarsus: [36.75, 37.3, 34.75, 35.25],
  Toroslar: [36.75, 37.15, 34.45, 34.85],
  Yenişehir: [36.7, 36.9, 34.48, 34.75],
};

const payload = JSON.parse(await readFile(inputFile, "utf8"));
const issues = [];
const warnings = [];

for (const station of payload.stations || []) {
  const bounds = districtBounds[station.district];
  const latitude = Number(station.latitude);
  const longitude = Number(station.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    issues.push(issue(station, "missing-coordinate", latitude, longitude));
    continue;
  }

  if (!bounds) {
    warnings.push(issue(station, "unknown-district", latitude, longitude));
    continue;
  }

  const [minLat, maxLat, minLng, maxLng] = bounds;
  const outsideDistrict = latitude < minLat || latitude > maxLat || longitude < minLng || longitude > maxLng;
  if (outsideDistrict) {
    issues.push(issue(station, "outside-district-bounds", latitude, longitude));
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  checkedStations: payload.stations?.length || 0,
  issueCount: issues.length,
  warningCount: warnings.length,
  issues,
  warnings,
};

await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`checked=${report.checkedStations}`);
console.log(`issues=${report.issueCount}`);
console.log(`warnings=${report.warningCount}`);
console.log(`report=${outputFile}`);

function issue(station, reason, latitude, longitude) {
  return {
    reason,
    stationNo: station.stationNo,
    name: station.name,
    district: station.district,
    address: station.address,
    latitude,
    longitude,
    geocodeQuality: station.geocodeQuality || "",
    geocodeProvider: station.geocodeProvider || "",
  };
}
