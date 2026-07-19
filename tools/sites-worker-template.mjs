const ASSETS = new Map(__ASSETS_JSON__);
const STATIONS_DATA = JSON.parse(ASSETS.get("/data/stations.json").content);
const ADMIN_PATH = "/api/admin/stations";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-admin-token",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

let dbReadyPromise = null;

function assetForPath(pathname) {
  if (pathname === "/") return ASSETS.get("/index.html");
  if (pathname === "/admin") return ASSETS.get("/admin/index.html");
  return ASSETS.get(pathname) || ASSETS.get("/index.html");
}

async function responseFor(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  const apiResponse = await responseForApi(request, url, env);
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

async function responseForApi(request, url, env) {
  if (url.pathname === "/api/v1/health" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      service: "limonup-stations",
      version: "1.1.0",
      storage: env.DB ? "d1" : "static-json",
      generatedAt: STATIONS_DATA.generatedAt,
    });
  }

  if (url.pathname === "/api/v1/stations" && request.method === "GET") {
    const allStations = await getStations(env);
    const stations = filteredStations(allStations, url.searchParams).map(publicStation);
    return jsonResponse({
      data: stations,
      meta: buildMeta(allStations, stations),
    });
  }

  if (url.pathname.startsWith("/api/v1/stations/") && request.method === "GET") {
    const stationNo = decodeURIComponent(url.pathname.slice("/api/v1/stations/".length));
    const station = (await getStations(env)).find((item) => item.stationNo === stationNo);
    if (!station) return jsonResponse({ error: "station_not_found" }, 404);
    return jsonResponse({ data: publicStation(station) });
  }

  if (url.pathname === "/api/v1/districts" && request.method === "GET") {
    const stations = filteredStations(await getStations(env), url.searchParams);
    return jsonResponse({ data: buildDistricts(stations) });
  }

  if (url.pathname === "/api/v1/brands" && request.method === "GET") {
    const stations = filteredStations(await getStations(env), url.searchParams);
    return jsonResponse({ data: buildBrands(stations) });
  }

  if (url.pathname === ADMIN_PATH && request.method === "GET") {
    const auth = requireAdmin(request, env);
    if (auth) return auth;
    const stations = filteredStations(await getStations(env), url.searchParams).map(publicStation);
    return jsonResponse({ data: stations, meta: buildMeta(await getStations(env), stations) });
  }

  if (url.pathname === ADMIN_PATH && request.method === "POST") {
    const auth = requireAdmin(request, env);
    if (auth) return auth;
    return saveStationResponse(request, env);
  }

  if (url.pathname.startsWith(`${ADMIN_PATH}/`)) {
    const auth = requireAdmin(request, env);
    if (auth) return auth;

    const stationNo = decodeURIComponent(url.pathname.slice(`${ADMIN_PATH}/`.length));
    if (request.method === "GET") {
      const station = (await getStations(env)).find((item) => item.stationNo === stationNo);
      if (!station) return jsonResponse({ error: "station_not_found" }, 404);
      return jsonResponse({ data: publicStation(station) });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      return saveStationResponse(request, env, stationNo);
    }
  }

  return null;
}

async function getStations(env) {
  if (!env.DB) return STATIONS_DATA.stations.filter((station) => station.isActive !== false);
  await ensureDb(env.DB);
  const { results } = await env.DB
    .prepare("SELECT station_json FROM stations WHERE is_active = 1 ORDER BY sequence ASC, station_no ASC")
    .all();
  return results.map((row) => JSON.parse(row.station_json));
}

async function ensureDb(db) {
  dbReadyPromise ||= initializeDb(db);
  return dbReadyPromise;
}

async function initializeDb(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS stations (station_no TEXT PRIMARY KEY, sequence INTEGER, station_json TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS stations_active_sequence_idx ON stations (is_active, sequence)"),
    db.prepare("CREATE TABLE IF NOT EXISTS station_audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, station_no TEXT NOT NULL, action TEXT NOT NULL, actor TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS station_audit_logs_station_idx ON station_audit_logs (station_no, created_at)"),
  ]);

  const existing = await db.prepare("SELECT COUNT(*) AS count FROM stations").first();
  if (Number(existing?.count || 0) > 0) return;

  const now = new Date().toISOString();
  for (let index = 0; index < STATIONS_DATA.stations.length; index += 50) {
    const chunk = STATIONS_DATA.stations.slice(index, index + 50);
    await db.batch(chunk.map((station) => (
      db.prepare("INSERT INTO stations (station_no, sequence, station_json, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
        .bind(station.stationNo, Number(station.sequence || 0), JSON.stringify(station), now, now)
    )));
  }
}

async function saveStationResponse(request, env, stationNoFromPath = "") {
  if (!env.DB) return jsonResponse({ error: "database_unavailable" }, 503);
  await ensureDb(env.DB);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonResponse({ error: "invalid_json" }, 400);

  const stations = await getStations(env);
  const requestedStationNo = stationNoFromPath || String(body.stationNo || "").trim();
  if (!requestedStationNo) return jsonResponse({ error: "station_no_required" }, 400);

  const existing = stations.find((item) => item.stationNo === requestedStationNo);
  const next = normalizeStationPayload(body, existing, requestedStationNo);
  const validationError = validateStation(next);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const now = new Date().toISOString();
  const actor = authenticatedEmail(request) || "admin";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO stations (station_no, sequence, station_json, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(station_no) DO UPDATE SET sequence = excluded.sequence, station_json = excluded.station_json, is_active = excluded.is_active, updated_at = excluded.updated_at")
      .bind(next.stationNo, Number(next.sequence || 9999), JSON.stringify(next), now, now),
    env.DB.prepare("INSERT INTO station_audit_logs (station_no, action, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(next.stationNo, existing ? "update" : "create", actor, existing ? JSON.stringify(existing) : null, JSON.stringify(next), now),
  ]);

  return jsonResponse({ data: publicStation(next), saved: true });
}

function normalizeStationPayload(body, existing, stationNo) {
  const next = {
    ...(existing || {
      sequence: 9999,
      stationNo,
      serviceType: "HALKA_ACIK",
      city: "Mersin",
      green: false,
      sockets: [],
    }),
  };

  const simpleFields = [
    "name",
    "brand",
    "networkOperator",
    "stationOperator",
    "serviceType",
    "district",
    "city",
    "address",
    "normalizedAddress",
    "locationStatus",
    "verificationSource",
    "verificationNote",
  ];

  simpleFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) next[field] = cleanString(body[field]);
  });

  next.stationNo = stationNo;
  next.latitude = coordinateOrNull(body.latitude, existing?.latitude);
  next.longitude = coordinateOrNull(body.longitude, existing?.longitude);
  next.sockets = normalizeSockets(body.sockets ?? existing?.sockets ?? []);
  next.locationStatus = next.locationStatus || stationLocationStatus(next);
  next.geocodeProvider = body.verificationSource || body.geocodeProvider || existing?.geocodeProvider || "LimonUp panel";
  next.geocodeDisplayName = next.name || existing?.geocodeDisplayName || stationNo;
  next.geocodedAt = new Date().toISOString();
  next.googleSearchQuery = next.address ? `${next.address}, Mersin, Türkiye` : next.googleSearchQuery;
  next.normalizedAddress = next.normalizedAddress || next.address || "";
  next.mapTitle = next.name || next.mapTitle || stationNo;
  return next;
}

function validateStation(station) {
  if (!station.name) return "name_required";
  if (!station.district) return "district_required";
  if (station.latitude !== null && (station.latitude < 35 || station.latitude > 38)) return "latitude_out_of_range";
  if (station.longitude !== null && (station.longitude < 32 || station.longitude > 36)) return "longitude_out_of_range";
  if (!["verified", "unverified", "missing", "rejected"].includes(station.locationStatus)) return "invalid_location_status";
  if (!Array.isArray(station.sockets)) return "invalid_sockets";
  return "";
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function coordinateOrNull(value, fallback) {
  const source = value === undefined ? fallback : value;
  if (source === null || source === "") return null;
  const number = Number(source);
  return Number.isFinite(number) ? number : null;
}

function normalizeSockets(value) {
  const sockets = typeof value === "string" ? JSON.parse(value || "[]") : value;
  if (!Array.isArray(sockets)) return [];
  return sockets.map((socket) => ({
    socketNo: cleanString(socket.socketNo),
    currentType: cleanString(socket.currentType || "").toUpperCase(),
    connectorType: cleanString(socket.connectorType || socket.socketType),
    powerKw: Number(socket.powerKw || 0),
  })).filter((socket) => socket.currentType || socket.connectorType || socket.powerKw);
}

function requireAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (token && request.headers.get("x-admin-token") === token) return null;

  const email = authenticatedEmail(request);
  if (!email) return jsonResponse({ error: "admin_auth_required" }, 401);

  const allowed = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLocaleLowerCase("tr-TR"))
    .filter(Boolean);
  if (allowed.length && !allowed.includes(email.toLocaleLowerCase("tr-TR"))) {
    return jsonResponse({ error: "admin_forbidden" }, 403);
  }

  return null;
}

function authenticatedEmail(request) {
  return request.headers.get("oai-authenticated-user-email") || "";
}

function filteredStations(stations, searchParams) {
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

  return stations
    .filter((station) => {
      if (station.isActive === false) return false;
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
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station.latitude},${station.longitude}`)}`
        : null,
    },
  };
}

function stationLocationStatus(station) {
  if (station.locationStatus) return station.locationStatus;
  if (!stationHasLocation(station)) return "missing";
  return station.geocodeQuality === "pdf-verified" ? "verified" : "unverified";
}

function buildMeta(allStations, returnedStations) {
  return {
    city: STATIONS_DATA.city || "Mersin",
    total: allStations.length,
    returned: returnedStations.length,
    verified: countByStatus(allStations, "verified"),
    unverified: countByStatus(allStations, "unverified"),
    missing: countByStatus(allStations, "missing"),
    generatedAt: STATIONS_DATA.generatedAt,
    geocoding: STATIONS_DATA.geocoding || null,
  };
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
  const parts = [`${sockets.length} soket`];
  if (dcCount) parts.push(`${dcCount} DC`);
  if (acCount) parts.push(`${acCount} AC`);
  if (maxPower) parts.push(`${maxPower} kW`);
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
