import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env");
loadEnvFile(envPath);

const publicDir = join(root, "public");
const dataPath = join(publicDir, "data", "stations.json");
const mirrorDataPath = join(root, "data", "stations.json");
const eventsPath = join(publicDir, "data", "events.json");
const taxiTariffPath = join(publicDir, "data", "taxi-tariff.json");
const port = Number(process.env.PORT || 4184);
const adminPassword = process.env.ADMIN_PASSWORD || "limonup-admin";
let etkinlikToken = process.env.ETKINLIK_IO_TOKEN || "";
const sessionSecret = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");
const osrmRouteUrl = "https://router.project-osrm.org/route/v1/driving";
const nominatimSearchUrl = "https://nominatim.openstreetmap.org/search";
const nominatimReverseUrl = "https://nominatim.openstreetmap.org/reverse";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

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

  if (url.pathname === "/api/v1/events" && request.method === "GET") {
    const data = await loadEventsData();
    const cityEvents = data.events.filter((event) => isConfiguredEventCity(event, data.config.city || "Mersin"));
    const events = filterEvents(cityEvents, url.searchParams);
    sendJson(response, {
      data: events,
      meta: {
        total: cityEvents.length,
        returned: events.length,
        provider: data.config.provider,
        enabled: Boolean(data.config.enabled),
        city: data.config.city,
        lastSyncedAt: data.config.lastSyncedAt,
        filters: buildEventFilters(cityEvents),
      },
    });
    return true;
  }

  if (url.pathname === "/api/v1/taxi/tariff" && request.method === "GET") {
    sendJson(response, { tariff: await loadTaxiTariff() });
    return true;
  }

  if (url.pathname === "/api/v1/taxi/estimate" && request.method === "POST") {
    const body = await readRequestJson(request);
    const tariff = await loadTaxiTariff();
    const estimate = estimateTaxiFare(body.distanceKm, tariff);
    if (!estimate) {
      sendJson(response, { error: "invalid_distance" }, 400);
      return true;
    }
    sendJson(response, { estimate, tariff });
    return true;
  }

  if (url.pathname === "/api/v1/taxi/geocode" && request.method === "GET") {
    const points = await geocodeTaxiPoints(url.searchParams.get("q") || "");
    sendJson(response, points.length ? { point: points[0], points } : { error: "address_not_found", points: [] }, points.length ? 200 : 404);
    return true;
  }

  if (url.pathname === "/api/v1/taxi/reverse" && request.method === "GET") {
    const point = await reverseGeocodeTaxiPoint(url.searchParams.get("lat"), url.searchParams.get("lng"));
    sendJson(response, point ? { point } : { error: "address_not_found" }, point ? 200 : 404);
    return true;
  }

  if (url.pathname === "/api/v1/taxi/route" && request.method === "POST") {
    const body = await readRequestJson(request);
    const route = await fetchTaxiRoute(body.start, body.end);
    sendJson(response, route ? { route } : { error: "route_not_found" }, route ? 200 : 400);
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

  if (url.pathname === "/api/admin/events/settings" && request.method === "GET") {
    const data = await loadEventsData();
    sendJson(response, {
      config: {
        ...data.config,
        hasToken: Boolean(etkinlikToken),
      },
    });
    return true;
  }

  if (url.pathname === "/api/admin/taxi/tariff" && request.method === "GET") {
    sendJson(response, { tariff: await loadTaxiTariff() });
    return true;
  }

  if (url.pathname === "/api/admin/taxi/tariff" && request.method === "PUT") {
    const body = await readRequestJson(request);
    const tariff = normalizeTaxiTariff(body, await loadTaxiTariff());
    await saveTaxiTariff(tariff);
    sendJson(response, { tariff, saved: true });
    return true;
  }

  if (url.pathname === "/api/admin/events/settings" && request.method === "PUT") {
    const body = await readRequestJson(request);
    const data = await loadEventsData();
    data.config = normalizeEventsConfig(body, data.config);
    if (cleanString(body.apiToken)) {
      etkinlikToken = cleanString(body.apiToken);
      process.env.ETKINLIK_IO_TOKEN = etkinlikToken;
      await saveEnvValue(envPath, "ETKINLIK_IO_TOKEN", etkinlikToken);
    }
    await saveEventsData(data);
    sendJson(response, { config: { ...data.config, hasToken: Boolean(etkinlikToken) }, saved: true });
    return true;
  }

  if (url.pathname === "/api/admin/events/sync" && request.method === "POST") {
    const data = await loadEventsData();
    if (!etkinlikToken) {
      sendJson(response, { error: "etkinlik_token_missing" }, 400);
      return true;
    }

    const events = await fetchEtkinlikEvents(data.config);
    data.events = events;
    data.config.lastSyncedAt = new Date().toISOString();
    await saveEventsData(data);
    sendJson(response, { synced: true, count: events.length, config: { ...data.config, hasToken: true } });
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

async function loadEventsData() {
  return JSON.parse(await readFile(eventsPath, "utf8"));
}

async function saveEventsData(data) {
  await writeFile(eventsPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function saveEnvValue(filePath, key, value) {
  let lines = [];
  try {
    lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
  } catch {
    lines = [];
  }

  const escapedValue = String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const nextLine = `${key}="${escapedValue}"`;
  let found = false;
  lines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return line;
    if (trimmed.slice(0, separator).trim() !== key) return line;
    found = true;
    return nextLine;
  }).filter((line, index, all) => line !== "" || index < all.length - 1);

  if (!found) lines.push(nextLine);
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function loadTaxiTariff() {
  return JSON.parse(await readFile(taxiTariffPath, "utf8"));
}

async function saveTaxiTariff(tariff) {
  await writeFile(taxiTariffPath, `${JSON.stringify(tariff, null, 2)}\n`, "utf8");
}

async function loadStations() {
  return (await loadData()).stations.filter((station) => station.isActive !== false);
}

function normalizeTaxiTariff(body, current) {
  return {
    ...current,
    openingFee: positiveNumber(body.openingFee, current.openingFee),
    perKmFee: positiveNumber(body.perKmFee, current.perKmFee),
    minimumFare: positiveNumber(body.minimumFare, current.minimumFare),
    roundTo: positiveNumber(body.roundTo, current.roundTo || 1),
    effectiveLabel: cleanString(body.effectiveLabel || current.effectiveLabel || "Mersin taksi tarifesi"),
    sourceLabel: cleanString(body.sourceLabel || current.sourceLabel || "LimonUp yerel tarife"),
    notice: cleanString(body.notice || current.notice || "Tahmini sonuçtur, kesin ücret değildir."),
    updatedAt: new Date().toISOString(),
  };
}

function estimateTaxiFare(distanceKmValue, tariff) {
  const distanceKm = Number(distanceKmValue);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 1000) return null;
  const openingFee = Number(tariff.openingFee || 0);
  const perKmFee = Number(tariff.perKmFee || 0);
  const minimumFare = Number(tariff.minimumFare || 0);
  const distanceFee = distanceKm * perKmFee;
  const calculated = openingFee + distanceFee;
  const amountBeforeRound = Math.max(minimumFare, calculated);
  const roundTo = Number(tariff.roundTo || 1);
  return {
    distanceKm,
    fare: {
      amount: roundMoney(amountBeforeRound, roundTo),
      openingFee,
      distanceFee: roundMoney(distanceFee, roundTo),
      minimumApplied: amountBeforeRound > calculated,
    },
    notice: tariff.notice,
  };
}

async function geocodeTaxiPoints(query) {
  const cleanQuery = cleanString(query);
  if (cleanQuery.length < 3) return [];
  const coordinate = parseCoordinatePair(cleanQuery);
  if (coordinate) return [{ ...coordinate, label: cleanQuery }];

  const url = new URL(nominatimSearchUrl);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "tr");
  url.searchParams.set("countrycodes", "tr");
  url.searchParams.set("viewbox", "33.0,37.7,35.6,35.7");
  url.searchParams.set("bounded", "1");
  url.searchParams.set("q", `${cleanQuery}, Mersin, Türkiye`);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "LimonUp local taxi calculator",
    },
  });
  if (!response.ok) return [];
  const results = await response.json();
  return (Array.isArray(results) ? results : [])
    .map((result) => ({
      lat: Number(result.lat),
      lng: Number(result.lon),
      label: result.display_name || cleanQuery,
    }))
    .filter((point) => isMersinCoordinate(point.lat, point.lng));
}

async function reverseGeocodeTaxiPoint(latValue, lngValue) {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!isMersinCoordinate(lat, lng)) return null;

  const url = new URL(nominatimReverseUrl);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("accept-language", "tr");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "LimonUp local taxi calculator",
      },
    });
    if (!response.ok) throw new Error("reverse_failed");
    const data = await response.json();
    return {
      lat,
      lng,
      label: data.display_name || "Mevcut konum",
    };
  } catch {
    return {
      lat,
      lng,
      label: "Mevcut konum",
    };
  }
}

async function fetchTaxiRoute(start, end) {
  const startPoint = normalizePoint(start);
  const endPoint = normalizePoint(end);
  if (!startPoint || !endPoint) return null;

  const route = await fetchOsrmRoute(startPoint, endPoint);
  if (!route || !Number.isFinite(Number(route.distance))) return null;
  return {
    distanceKm: Number(route.distance) / 1000,
    durationSeconds: Number(route.duration || 0),
    geometry: route.geometry || null,
  };
}

async function fetchOsrmRoute(startPoint, endPoint) {
  const startText = `${startPoint.lng},${startPoint.lat}`;
  const endText = `${endPoint.lng},${endPoint.lat}`;
  const url = `${osrmRouteUrl}/${encodeURIComponent(startText)};${encodeURIComponent(endText)}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const data = await response.json();
  return data.routes?.[0] || null;
}

function parseCoordinatePair(value) {
  const match = String(value || "").trim().match(/^(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1].replace(",", "."));
  const lng = Number(match[2].replace(",", "."));
  if (!isMersinCoordinate(lat, lng)) return null;
  return { lat, lng };
}

function normalizePoint(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!isMersinCoordinate(lat, lng)) return null;
  return { lat, lng };
}

function roundMoney(value, roundTo) {
  if (!Number.isFinite(roundTo) || roundTo <= 0) return Math.round(value);
  return Math.round(value / roundTo) * roundTo;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : Number(fallback || 0);
}

function isMersinCoordinate(lat, lng) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= 35
    && lat <= 38
    && lng >= 32
    && lng <= 36;
}

function normalizeEventsConfig(body, current) {
  return {
    ...current,
    enabled: Boolean(body.enabled),
    provider: "etkinlik.io",
    baseUrl: cleanString(body.baseUrl || current.baseUrl || "https://etkinlik.io/api/v2/events"),
    city: cleanString(body.city || "Mersin"),
    limit: Math.max(1, Math.min(100, Number(body.limit || current.limit || 50))),
  };
}

async function fetchEtkinlikEvents(config) {
  const url = new URL(config.baseUrl || "https://etkinlik.io/api/v2/events");
  const cityId = await resolveEtkinlikCityId(config.city || "Mersin");
  if (cityId) url.searchParams.set("city_ids", String(cityId));
  if (config.limit) url.searchParams.set("take", String(config.limit));
  url.searchParams.set("sort_by", "upcoming");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Etkinlik-Token": etkinlikToken,
    },
  });
  if (!response.ok) throw Object.assign(new Error("etkinlik_fetch_failed"), { statusCode: response.status });

  const payload = await response.json();
  const rawEvents = Array.isArray(payload) ? payload : payload.items || payload.data || payload.events || [];
  return rawEvents
    .map(normalizeEvent)
    .filter((event) => event.title)
    .filter((event) => isConfiguredEventCity(event, config.city || "Mersin"));
}

async function resolveEtkinlikCityId(city) {
  const directId = Number(city);
  if (Number.isInteger(directId) && directId > 0) return directId;

  const response = await fetch("https://etkinlik.io/api/v2/cities", {
    headers: {
      Accept: "application/json",
      "X-Etkinlik-Token": etkinlikToken,
    },
  });
  if (!response.ok) return "";

  const payload = await response.json();
  const cities = Array.isArray(payload) ? payload : payload.items || payload.data || [];
  const expected = normalizeText(city || "Mersin");
  const found = cities.find((item) => normalizeText(item.name) === expected || normalizeText(item.slug) === expected);
  return found?.id || "";
}

function normalizeEvent(event) {
  const venue = event.venue_data || event.venue || event.place || event.location || {};
  const city = event.city || venue.city || venue.city_name || event.city_name || event.cityName || "";
  const category = event.category || event.genre || event.interest || {};
  const format = event.format || event.type || event.eventType || {};
  const performers = normalizePerformers(event);
  return {
    id: String(event.id || event.uuid || event.slug || `${event.name || event.title}-${event.startDate || event.date || ""}`),
    title: cleanString(event.title || event.name),
    startsAt: cleanString(event.start_r001 || event.startsAt || event.startDate || event.start_time || event.date || event.start),
    endsAt: cleanString(event.end_r001 || event.endsAt || event.endDate || event.end_time || event.end),
    venueName: cleanString(venue.name || event.venueName || event.placeName),
    address: cleanString(venue.address || event.address),
    city: cleanString(readName(city) || "Mersin"),
    category: cleanString(readName(category)),
    type: cleanString(readName(format)),
    artist: cleanString(performers[0] || event.artist_name || event.artist || event.performer),
    performers,
    latitude: coordinateOrNull(venue.lat || event.lat || event.latitude, null),
    longitude: coordinateOrNull(venue.lng || venue.lon || event.lng || event.longitude, null),
    imageUrl: cleanString(event.poster_url || event.image_url || event.imageUrl || event.image || event.posterUrl),
    sourceUrl: cleanString(event.url || event.sourceUrl || event.webUrl || event.web_url || event.detail_url || event.ticket_url),
    ticketUrl: cleanString(event.ticket_url || event.ticketUrl || ""),
  };
}

function filterEvents(events, searchParams) {
  const query = normalizeText(searchParams.get("q") || "");
  const artist = normalizeText(searchParams.get("artist") || "");
  const type = searchParams.get("type") || "";
  const category = searchParams.get("category") || "";
  const date = searchParams.get("date") || "";
  const month = searchParams.get("month") || "";
  return events.filter((event) => {
    if (type && event.type !== type && event.category !== type) return false;
    if (category && event.category !== category) return false;
    if (date && !serverEventMatchesDate(event, date)) return false;
    if (month && eventMonthKey(event.startsAt) !== month) return false;
    if (artist && !normalizeText([event.artist, event.performers?.join(" "), event.title].join(" ")).includes(artist)) return false;
    if (!query) return true;
    return normalizeText([event.title, event.venueName, event.address, event.category, event.type, event.artist].join(" ")).includes(query);
  });
}

function eventMonthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizePerformers(event) {
  const sources = [event.performers, event.artists, event.artist, event.performer].filter(Boolean);
  return sources.flatMap((source) => {
    if (Array.isArray(source)) return source.map(readName);
    return [readName(source)];
  }).map(cleanString).filter(Boolean);
}

function readName(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.name || value.title || value.label || value.slug || "";
  return String(value);
}

function isConfiguredEventCity(event, city) {
  const expected = normalizeText(city || "Mersin");
  if (!expected) return true;
  if (normalizeText([event.city, event.address, event.venueName].join(" ")).includes(expected)) return true;
  return isMersinCoordinate(Number(event.latitude), Number(event.longitude));
}

function serverEventMatchesDate(event, range) {
  const date = new Date(event.startsAt);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((eventDay - today) / (24 * 60 * 60 * 1000));
  if (range === "today") return dayDiff === 0;
  if (range === "tomorrow") return dayDiff === 1;
  if (range === "week") return dayDiff >= 0 && dayDiff < 7;
  if (range === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (range === "weekend") return dayDiff >= 0 && dayDiff < 7 && (date.getDay() === 0 || date.getDay() === 6);
  return true;
}

function buildEventFilters(events) {
  return {
    types: [...new Set(events.flatMap((event) => [event.type, event.category]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")),
    artists: [...new Set(events.flatMap((event) => [event.artist, ...(event.performers || [])]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")),
  };
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
    const isAdminAsset = cleanPath.startsWith("/admin/");
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": isAdminAsset ? "no-store" : "no-cache",
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
    ".svg": "image/svg+xml",
  }[extname(filePath)] || "text/plain; charset=utf-8";
}
