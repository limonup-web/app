import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const publicDir = join(root, "public");
const dataPath = join(publicDir, "data", "stations.json");
const mirrorDataPath = join(root, "data", "stations.json");
const port = Number(process.env.PORT || 4184);
const adminPassword = process.env.ADMIN_PASSWORD || "limonup-admin";
const sessionSecret = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      sendJson(response, null, 204);
      return;
    }

    if (await handleApi(request, response, url)) return;
    await serveAsset(response, url.pathname);
  } catch (error) {
    sendJson(response, {
      error: error.statusCode === 400 ? "invalid_json" : "server_error",
      detail: String(error.message || error),
    }, error.statusCode || 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LimonUp local: http://127.0.0.1:${port}/`);
  console.log(`Panel: http://127.0.0.1:${port}/admin`);
});

async function handleApi(request, response, url) {
  if (url.pathname === "/api/v1/health" && request.method === "GET") {
    sendJson(response, {
      ok: true,
      service: "limonup-stations",
      version: "local-dev",
      storage: "local-json",
    });
    return true;
  }

  if (url.pathname === "/api/v1/stations" && request.method === "GET") {
    const allStations = await loadStations();
    const stations = filteredStations(allStations, url.searchParams).map(publicStation);
    sendJson(response, { data: stations, meta: buildMeta(allStations, stations) });
    return true;
  }

  if (url.pathname.startsWith("/api/v1/stations/") && request.method === "GET") {
    const stationNo = decodeURIComponent(url.pathname.slice("/api/v1/stations/".length));
    const station = (await loadStations()).find((item) => item.stationNo === stationNo);
    sendJson(response, station ? { data: publicStation(station) } : { error: "station_not_found" }, station ? 200 : 404);
    return true;
  }

  if (url.pathname === "/api/v1/districts" && request.method === "GET") {
    sendJson(response, { data: buildDistricts(filteredStations(await loadStations(), url.searchParams)) });
    return true;
  }

  if (url.pathname === "/api/v1/brands" && request.method === "GET") {
    sendJson(response, { data: buildBrands(filteredStations(await loadStations(), url.searchParams)) });
    return true;
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    const body = await readRequestJson(request);
    if (safeEqual(String(body.password || ""), adminPassword)) {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `limonup_admin=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
      });
      response.end(JSON.stringify({ ok: true }));
      return true;
    }

    sendJson(response, { error: "invalid_password" }, 401);
    return true;
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "limonup_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
    response.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (url.pathname === "/api/admin/me" && request.method === "GET") {
    sendJson(response, { authenticated: isAdminAuthenticated(request) });
    return true;
  }

  if (url.pathname.startsWith("/api/admin/") && !isAdminAuthenticated(request)) {
    sendJson(response, { error: "admin_auth_required" }, 401);
    return true;
  }

  if (url.pathname === "/api/admin/stations" && request.method === "GET") {
    const allStations = await loadStations();
    const stations = filteredStations(allStations, url.searchParams).map(publicStation);
    sendJson(response, { data: stations, meta: buildMeta(allStations, stations) });
    return true;
  }

  if (url.pathname === "/api/admin/stations" && request.method === "POST") {
    await saveStationResponse(request, response);
    return true;
  }

  if (url.pathname.startsWith("/api/admin/stations/")) {
    const stationNo = decodeURIComponent(url.pathname.slice("/api/admin/stations/".length));

    if (request.method === "GET") {
      const station = (await loadStations()).find((item) => item.stationNo === stationNo);
      sendJson(response, station ? { data: publicStation(station) } : { error: "station_not_found" }, station ? 200 : 404);
      return true;
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      await saveStationResponse(request, response, stationNo);
      return true;
    }
  }

  return false;
}

function sessionToken() {
  return signSession("admin");
}

function isAdminAuthenticated(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  return cookies.limonup_admin === sessionToken();
}

function signSession(value) {
  return createHash("sha256").update(`${value}.${sessionSecret}`).digest("hex");
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return [part, ""];
      return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
    }));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function loadData() {
  return JSON.parse(await readFile(dataPath, "utf8"));
}

async function loadStations() {
  return (await loadData()).stations.filter((station) => station.isActive !== false);
}

async function saveStationResponse(request, response, stationNoFromPath = "") {
  const body = await readRequestJson(request);
  if (!body || typeof body !== "object") {
    sendJson(response, { error: "invalid_json" }, 400);
    return;
  }

  const data = await loadData();
  const requestedStationNo = stationNoFromPath || String(body.stationNo || "").trim();
  if (!requestedStationNo) {
    sendJson(response, { error: "station_no_required" }, 400);
    return;
  }

  const index = data.stations.findIndex((item) => item.stationNo === requestedStationNo);
  const existing = index >= 0 ? data.stations[index] : null;
  const next = normalizeStationPayload(body, existing, requestedStationNo);
  const validationError = validateStation(next);
  if (validationError) {
    sendJson(response, { error: validationError }, 400);
    return;
  }

  if (index >= 0) data.stations[index] = next;
  else data.stations.push(next);
  data.stationCount = data.stations.length;
  data.generatedAt = new Date().toISOString();

  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await writeFile(mirrorDataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  sendJson(response, { data: publicStation(next), saved: true });
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

  [
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
  ].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) next[field] = cleanString(body[field]);
  });

  next.stationNo = stationNo;
  next.latitude = coordinateOrNull(body.latitude, existing?.latitude);
  next.longitude = coordinateOrNull(body.longitude, existing?.longitude);
  next.sockets = normalizeSockets(body.sockets ?? existing?.sockets ?? []);
  next.locationStatus = next.locationStatus || stationLocationStatus(next);
  next.geocodeProvider = body.verificationSource || body.geocodeProvider || existing?.geocodeProvider || "LimonUp yerel panel";
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
  return "";
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
      if (district && station.district !== district) return false;
      if (brand && station.brand !== brand) return false;
      if (socket && stationSocketMode(station) !== socket) return false;
      if (locationStatus !== "all" && stationLocationStatus(station) !== locationStatus) return false;
      if (query && !normalizeText([station.name, station.brand, station.address, station.stationNo, station.district].join(" ")).includes(query)) return false;
      if (hasRadius && Number.isFinite(radiusKm) && shouldSortByDistance) {
        const distance = stationDistanceKm(station, { lat, lng });
        return Number.isFinite(distance) && distance <= radiusKm;
      }
      return true;
    })
    .map((station) => shouldSortByDistance ? { ...station, distanceKm: stationDistanceKm(station, { lat, lng }) } : station)
    .sort((a, b) => shouldSortByDistance ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) : Number(a.sequence || 0) - Number(b.sequence || 0));
}

async function serveAsset(response, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname === "/admin" ? "/admin/index.html" : pathname;
  const filePath = normalize(join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) {
    sendText(response, "Forbidden", 403);
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(content);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fallback);
  }
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
    city: "Mersin",
    total: allStations.length,
    returned: returnedStations.length,
    verified: countByStatus(allStations, "verified"),
    unverified: countByStatus(allStations, "unverified"),
    missing: countByStatus(allStations, "missing"),
  };
}

function countByStatus(stations, status) {
  return stations.filter((station) => stationLocationStatus(station) === status).length;
}

function buildDistricts(stations) {
  return buildCounts(stations, (station) => station.district || "Bilinmiyor");
}

function buildBrands(stations) {
  return buildCounts(stations, (station) => station.brand || "Marka yok");
}

function buildCounts(stations, getValue) {
  const counts = new Map();
  stations.forEach((station) => {
    const value = getValue(station);
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "tr"))
    .map(([name, count]) => ({ name, count }));
}

function stationHasLocation(station) {
  return Number.isFinite(Number(station.latitude)) && Number.isFinite(Number(station.longitude));
}

function stationDistanceKm(station, point) {
  if (!stationHasLocation(station)) return null;
  return distanceKm(point, { lat: Number(station.latitude), lng: Number(station.longitude) });
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

function socketSummary(station) {
  const sockets = station.sockets || [];
  if (!sockets.length) return "Soket bilgisi yok";
  const powers = sockets.map((socket) => socket.powerKw).filter((power) => Number.isFinite(Number(power)));
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

function cleanString(value) {
  return String(value ?? "").trim();
}

function coordinateOrNull(value, fallback) {
  const source = value === undefined ? fallback : value;
  if (source === null || source === "") return null;
  const number = Number(source);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return String(value || "").toLocaleLowerCase("tr-TR");
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-admin-token",
  });
  response.end(data === null ? null : JSON.stringify(data));
}

function sendText(response, text, status = 200) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

function contentType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  }[extname(filePath)] || "text/plain; charset=utf-8";
}
