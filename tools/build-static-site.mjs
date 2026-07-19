import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const publicDir = join(root, "public");
const serverDir = join(dist, "server");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(publicDir, dist, { recursive: true });
await mkdir(serverDir, { recursive: true });
await mkdir(join(dist, ".openai"), { recursive: true });
await cp(join(root, ".openai", "hosting.json"), join(dist, ".openai", "hosting.json"));

const files = await collectFiles(publicDir);
const assets = [];

for (const relativePath of files) {
  const content = await readFile(join(publicDir, relativePath), "utf8");
  const urlPath = `/${relativePath.replaceAll("\\", "/")}`;
  assets.push([urlPath, {
    content,
    type: contentType(urlPath),
  }]);
}

const serverSource = `const ASSETS = new Map(${JSON.stringify(assets)});
const STATIONS_DATA = JSON.parse(ASSETS.get("/data/stations.json").content);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function assetForPath(pathname) {
  if (pathname === "/") return ASSETS.get("/index.html");
  return ASSETS.get(pathname) || ASSETS.get("/index.html");
}

function responseFor(request) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  const apiResponse = responseForApi(request, url);
  if (apiResponse) return apiResponse;

  const asset = assetForPath(url.pathname);
  return new Response(asset.content, {
    headers: {
      "content-type": asset.type,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function responseForApi(request, url) {
  if (request.method !== "GET") return null;
  if (url.pathname === "/api/v1/health") {
    return jsonResponse({
      ok: true,
      service: "limonup-stations",
      version: "1.0.0",
      generatedAt: STATIONS_DATA.generatedAt,
    });
  }

  if (url.pathname === "/api/v1/stations") {
    const stations = filteredStations(url.searchParams).map(publicStation);
    return jsonResponse({
      data: stations,
      meta: {
        city: STATIONS_DATA.city || "Mersin",
        total: STATIONS_DATA.stations.length,
        returned: stations.length,
        verified: countByStatus(STATIONS_DATA.stations, "verified"),
        unverified: countByStatus(STATIONS_DATA.stations, "unverified"),
        missing: countByStatus(STATIONS_DATA.stations, "missing"),
        generatedAt: STATIONS_DATA.generatedAt,
        geocoding: STATIONS_DATA.geocoding || null,
      },
    });
  }

  if (url.pathname.startsWith("/api/v1/stations/")) {
    const stationNo = decodeURIComponent(url.pathname.slice("/api/v1/stations/".length));
    const station = STATIONS_DATA.stations.find((item) => item.stationNo === stationNo);
    if (!station) return jsonResponse({ error: "station_not_found" }, 404);
    return jsonResponse({ data: publicStation(station) });
  }

  if (url.pathname === "/api/v1/districts") {
    return jsonResponse({ data: buildDistricts(filteredStations(url.searchParams)) });
  }

  if (url.pathname === "/api/v1/brands") {
    return jsonResponse({ data: buildBrands(filteredStations(url.searchParams)) });
  }

  return null;
}

function filteredStations(searchParams) {
  const district = searchParams.get("district") || "";
  const brand = searchParams.get("brand") || "";
  const socket = searchParams.get("socket") || "";
  const query = normalizeText(searchParams.get("q") || "");
  const locationStatus = searchParams.get("location_status") || "all";
  const hasLat = searchParams.has("lat");
  const hasLng = searchParams.has("lng");
  const hasRadius = searchParams.has("radius_km");
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radiusKm = Number(searchParams.get("radius_km"));
  const shouldSortByDistance = hasLat && hasLng && Number.isFinite(lat) && Number.isFinite(lng);

  return STATIONS_DATA.stations
    .filter((station) => {
      if (district && station.district !== district) return false;
      if (brand && station.brand !== brand) return false;
      if (socket && stationSocketMode(station) !== socket) return false;
      if (locationStatus !== "all" && stationLocationStatus(station) !== locationStatus) return false;
      if (query && !normalizeText([
        station.name,
        station.brand,
        station.address,
        station.normalizedAddress,
        station.googleSearchQuery,
        station.stationNo,
        station.district,
      ].join(" ")).includes(query)) return false;

      if (hasRadius && Number.isFinite(radiusKm) && shouldSortByDistance) {
        const distance = stationDistanceKm(station, { lat, lng });
        return Number.isFinite(distance) && distance <= radiusKm;
      }

      return true;
    })
    .map((station) => {
      if (!shouldSortByDistance) return station;
      return { ...station, distanceKm: stationDistanceKm(station, { lat, lng }) };
    })
    .sort((a, b) => {
      if (!shouldSortByDistance) return Number(a.sequence || 0) - Number(b.sequence || 0);
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    });
}

function publicStation(station) {
  return {
    ...station,
    locationStatus: stationLocationStatus(station),
    socketSummary: socketSummary(station),
    distanceKm: Number.isFinite(station.distanceKm) ? station.distanceKm : null,
    links: {
      googleMaps: stationHasLocation(station)
        ? \`https://www.google.com/maps/search/?api=1&query=\${encodeURIComponent(\`\${station.latitude},\${station.longitude}\`)}\`
        : null,
    },
  };
}

function stationLocationStatus(station) {
  if (!stationHasLocation(station)) return "missing";
  if (station.locationStatus) return station.locationStatus;
  return station.geocodeQuality === "pdf-verified" ? "verified" : "unverified";
}

function countByStatus(stations, status) {
  return stations.filter((station) => stationLocationStatus(station) === status).length;
}

function buildDistricts(stations) {
  const counts = new Map();
  stations.forEach((station) => {
    const district = station.district || "Bilinmiyor";
    counts.set(district, (counts.get(district) || 0) + 1);
  });

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "tr"))
    .map(([name, count]) => ({ name, count }));
}

function buildBrands(stations) {
  const counts = new Map();
  stations.forEach((station) => {
    const brand = station.brand || "Marka yok";
    counts.set(brand, (counts.get(brand) || 0) + 1);
  });

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "tr"))
    .map(([name, count]) => ({ name, count }));
}

function stationHasLocation(station) {
  return Number.isFinite(Number(station.latitude)) && Number.isFinite(Number(station.longitude));
}

function stationCoordinates(station) {
  return {
    lat: Number(station.latitude),
    lng: Number(station.longitude),
  };
}

function stationDistanceKm(station, point) {
  if (!stationHasLocation(station)) return null;
  return distanceKm(point, stationCoordinates(station));
}

function distanceKm(from, to) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function socketSummary(station) {
  const sockets = station.sockets || [];
  if (!sockets.length) return "Soket bilgisi yok";

  const powers = sockets
    .map((socket) => socket.powerKw)
    .filter((power) => Number.isFinite(Number(power)));
  const maxPower = powers.length ? Math.max(...powers.map(Number)) : null;
  const dcCount = sockets.filter((socket) => socket.currentType === "DC").length;
  const acCount = sockets.filter((socket) => socket.currentType === "AC").length;
  const parts = [\`\${sockets.length} soket\`];
  if (dcCount) parts.push(\`\${dcCount} DC\`);
  if (acCount) parts.push(\`\${acCount} AC\`);
  if (maxPower) parts.push(\`\${maxPower} kW\`);
  return parts.join(" - ");
}

function stationSocketMode(station) {
  const sockets = station.sockets || [];
  const hasAc = sockets.some((socket) => socket.currentType === "AC");
  const hasDc = sockets.some((socket) => socket.currentType === "DC");
  if (hasAc && hasDc) return "AC_DC";
  if (hasAc) return "AC";
  if (hasDc) return "DC";
  return "";
}

function normalizeText(value) {
  return String(value || "").toLocaleLowerCase("tr-TR");
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

export default {
  fetch: responseFor,
};

export const fetch = responseFor;
`;

await writeFile(join(serverDir, "index.js"), serverSource);

async function collectFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      output.push(...await collectFiles(join(dir, entry.name), relativePath));
    } else if (entry.isFile()) {
      output.push(relativePath);
    }
  }

  return output;
}

function contentType(pathname) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}
