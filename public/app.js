const API_URLS = ["/api/v1/stations", "data/stations.json"];
const EVENT_API_URLS = ["/api/v1/events", "data/events.json"];
const ROUTE_API_URL = "https://router.project-osrm.org/route/v1/driving";
const MERSIN_CENTER = [36.8121, 34.6415];
const MAP_COLORS = {
  station: "#c73532",
  user: "#8f2425",
  route: "#8f2425",
};

const state = {
  meta: null,
  districts: [],
  stations: [],
  district: "",
  query: "",
  brand: "",
  socket: "",
  focusedStationNo: "",
  userLocation: null,
  userAccuracy: null,
  locating: false,
  nearestMode: false,
  routeStationNo: "",
  searchOpen: false,
  filterOpen: false,
  activeTab: "stations",
  events: [],
  eventMeta: null,
  eventQuery: "",
};

const els = {
  totalCount: document.querySelector("#totalCount"),
  resultCount: document.querySelector("#resultCount"),
  resultTitle: document.querySelector("#resultTitle"),
  districtSelect: document.querySelector("#districtSelect"),
  brandSelect: document.querySelector("#brandSelect"),
  socketSelect: document.querySelector("#socketSelect"),
  searchInput: document.querySelector("#searchInput"),
  searchToggle: document.querySelector("#searchToggle"),
  filterToggle: document.querySelector("#filterToggle"),
  searchPanel: document.querySelector("#searchPanel"),
  filterPanel: document.querySelector("#filterPanel"),
  stationList: document.querySelector("#stationList"),
  mapLabel: document.querySelector("#mapLabel"),
  mapSummary: document.querySelector("#mapSummary"),
  locateButton: document.querySelector("#locateButton"),
  locationStatus: document.querySelector("#locationStatus"),
  routeSummary: document.querySelector("#routeSummary"),
  clearRoute: document.querySelector("#clearRoute"),
  mapPanel: document.querySelector(".map-panel"),
  shell: document.querySelector(".shell"),
  pageTitle: document.querySelector("#pageTitle"),
  totalLabel: document.querySelector("#totalLabel"),
  stationsTab: document.querySelector("#stationsTab"),
  eventsTab: document.querySelector("#eventsTab"),
  stationControls: document.querySelector("#stationControls"),
  eventControls: document.querySelector("#eventControls"),
  stationResults: document.querySelector("#stationResults"),
  eventResults: document.querySelector("#eventResults"),
  eventSearchInput: document.querySelector("#eventSearchInput"),
  eventCount: document.querySelector("#eventCount"),
  eventList: document.querySelector("#eventList"),
};

let map;
let markersLayer;
let userMarker;
let userAccuracyCircle;
let routeLayer;
let locationWatchId = null;
let locationTimeoutId = null;

function initMap() {
  map = L.map("leafletMap", {
    zoomControl: true,
    preferCanvas: true,
  }).setView(MERSIN_CENTER, 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

function stationCoordinates(station) {
  return {
    lat: Number(station.latitude),
    lng: Number(station.longitude),
  };
}

function stationHasLocation(station) {
  return station.latitude !== null
    && station.longitude !== null
    && station.latitude !== ""
    && station.longitude !== ""
    && Number.isFinite(Number(station.latitude))
    && Number.isFinite(Number(station.longitude));
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
  return parts.join(" · ");
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

function formatDistance(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} sa ${rest} dk` : `${hours} sa`;
}

function withDistances(stations) {
  return stations.map((station) => {
    if (!state.userLocation || !stationHasLocation(station)) {
      return { ...station, distanceKm: null };
    }

    return {
      ...station,
      distanceKm: distanceKm(state.userLocation, stationCoordinates(station)),
    };
  });
}

function filteredStations() {
  const query = normalizeText(state.query);
  let stations = state.stations.filter((station) => {
    if (state.district && station.district !== state.district) return false;
    if (state.brand && station.brand !== state.brand) return false;
    if (state.socket && stationSocketMode(station) !== state.socket) return false;
    if (!query) return true;
    return normalizeText([
      station.name,
      station.brand,
      station.address,
      station.normalizedAddress,
      station.googleSearchQuery,
      station.stationNo,
      station.district,
    ].join(" ")).includes(query);
  });

  stations = withDistances(stations);

  if (state.nearestMode && state.userLocation) {
    stations.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }

  return stations;
}

function renderFilters() {
  const options = [`<option value="">Tüm ilçeler</option>`]
    .concat(state.districts.map((district) => (
      `<option value="${escapeHtml(district.name)}">${escapeHtml(district.name)} (${district.count})</option>`
    )));
  els.districtSelect.innerHTML = options.join("");
  els.districtSelect.value = state.district;

  const brands = [...new Set(state.stations
    .map((station) => station.brand)
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr"));
  els.brandSelect.innerHTML = [`<option value="">Tüm firmalar</option>`]
    .concat(brands.map((brand) => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`))
    .join("");
  els.brandSelect.value = state.brand;
  els.socketSelect.value = state.socket;
  renderToolPanels();
}

function renderToolPanels() {
  els.searchPanel.hidden = !state.searchOpen;
  els.filterPanel.hidden = !state.filterOpen;
  els.searchToggle.classList.toggle("active", state.searchOpen || state.query !== "");
  els.filterToggle.classList.toggle("active", state.filterOpen || state.brand !== "" || state.socket !== "");
  els.searchToggle.setAttribute("aria-expanded", String(state.searchOpen));
  els.filterToggle.setAttribute("aria-expanded", String(state.filterOpen));
}

function renderList(stations) {
  els.totalCount.textContent = state.meta.totalStations;
  els.resultCount.textContent = `${stations.length} kayıt`;
  els.resultTitle.textContent = listTitle();

  if (!stations.length) {
    els.stationList.innerHTML = `<div class="empty">Sonuç bulunamadı.</div>`;
    return;
  }

  els.stationList.innerHTML = stations.map((station) => {
    const distance = Number.isFinite(station.distanceKm) ? `<span>${formatDistance(station.distanceKm)} uzaklık</span>` : "";
    const hasLocation = stationHasLocation(station);
    const mapButton = hasLocation
      ? `<button type="button" class="primary" data-map-station="${escapeHtml(station.stationNo)}">Haritada göster</button>`
      : `<button type="button" class="primary" disabled>Konum doğrulanmadı</button>`;
    const googleMapsLink = hasLocation
      ? `<a href="${escapeHtml(googleMapsUrl(station))}" target="_blank" rel="noopener">Google Harita</a>`
      : "";
    const routeButton = state.userLocation && hasLocation
      ? `<button type="button" data-route-station="${escapeHtml(station.stationNo)}">Rota çiz</button>`
      : "";

    return `
      <article class="station${station.stationNo === state.focusedStationNo ? " active" : ""}">
        <div class="station-main">
          <div>
            <p class="district">${escapeHtml(station.district)}</p>
            <h3>${escapeHtml(station.name)}</h3>
          </div>
        </div>
        <p class="address">${escapeHtml(station.address)}</p>
        <div class="meta-row">
          <span>${escapeHtml(station.brand || "Marka yok")}</span>
          <span>${escapeHtml(station.stationNo)}</span>
          <span>${escapeHtml(socketSummary(station))}</span>
          ${distance}
        </div>
        <div class="actions">
          ${mapButton}
          ${googleMapsLink}
          ${routeButton}
        </div>
      </article>
    `;
  }).join("");
}

function listTitle() {
  if (state.nearestMode && state.userLocation) return "En yakın istasyonlar";
  if (state.brand || state.socket) return "Filtrelenen istasyonlar";
  return state.district ? `${state.district} istasyonları` : "Tüm istasyonlar";
}

function renderMap(stations) {
  markersLayer.clearLayers();

  const locatedStations = stations.filter(stationHasLocation);
  const bounds = [];
  const focusedStation = state.stations.find((station) => station.stationNo === state.focusedStationNo);

  locatedStations.forEach((station) => {
    if (station.stationNo === state.focusedStationNo) return;

    const { lat, lng } = stationCoordinates(station);
    const marker = L.circleMarker([lat, lng], {
      radius: 6,
      color: MAP_COLORS.station,
      fillColor: MAP_COLORS.station,
      fillOpacity: 0.9,
      weight: 2,
    });

    marker.bindPopup(popupHtml(station));
    marker.on("click", () => {
      state.focusedStationNo = station.stationNo;
      render();
    });
    marker.addTo(markersLayer);
    bounds.push([lat, lng]);
  });

  if (focusedStation && stationHasLocation(focusedStation)) {
    const { lat, lng } = stationCoordinates(focusedStation);
    const marker = L.marker([lat, lng], {
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: "selected-station-pin",
        html: `<span aria-hidden="true"></span>`,
        iconSize: [34, 42],
        iconAnchor: [17, 38],
        popupAnchor: [0, -34],
      }),
    });

    marker.bindPopup(popupHtml(focusedStation));
    marker.on("click", () => {
      state.focusedStationNo = focusedStation.stationNo;
      render();
    });
    marker.addTo(markersLayer);
    marker.openPopup();
    bounds.push([lat, lng]);
  }

  if (state.userLocation) {
    renderUserMarker();
    bounds.push([state.userLocation.lat, state.userLocation.lng]);
  }

  if (focusedStation && stationHasLocation(focusedStation)) {
    const { lat, lng } = stationCoordinates(focusedStation);
    map.setView([lat, lng], 17);
    els.mapLabel.textContent = focusedStation.name;
    els.mapSummary.textContent = summaryText(focusedStation);
    return;
  }

  if (routeLayer) {
    els.mapLabel.textContent = "Rota";
    return;
  }

  els.mapLabel.textContent = state.nearestMode ? "Yakındaki İstasyonlar" : "Mersin Haritası";
  els.mapSummary.textContent = `${locatedStations.length} istasyon gösteriliyor`;

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: state.nearestMode ? 13 : 11 });
  }
}

function popupHtml(station) {
  const distance = Number.isFinite(station.distanceKm) ? `<br>${escapeHtml(formatDistance(station.distanceKm))} uzaklık` : "";
  return `<strong>${escapeHtml(station.name)}</strong><br>${escapeHtml(station.district)}${distance}`;
}

function summaryText(station) {
  const parts = [station.district, station.stationNo];
  if (Number.isFinite(station.distanceKm)) parts.push(`${formatDistance(station.distanceKm)} uzaklık`);
  return parts.join(" · ");
}

function googleMapsUrl(station) {
  const { lat, lng } = stationCoordinates(station);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

function renderUserMarker() {
  const position = [state.userLocation.lat, state.userLocation.lng];
  const accuracy = Number(state.userAccuracy);

  if (!userAccuracyCircle) {
    userAccuracyCircle = L.circle(position, {
      radius: Number.isFinite(accuracy) ? accuracy : 0,
      color: MAP_COLORS.user,
      fillColor: MAP_COLORS.user,
      fillOpacity: 0.08,
      opacity: 0.22,
      weight: 1,
    }).addTo(map);
  } else {
    userAccuracyCircle.setLatLng(position);
    userAccuracyCircle.setRadius(Number.isFinite(accuracy) ? accuracy : 0);
  }

  if (!userMarker) {
    userMarker = L.circleMarker(position, {
      radius: 8,
      color: MAP_COLORS.user,
      fillColor: "#ffffff",
      fillOpacity: 1,
      weight: 3,
    }).addTo(map);
    userMarker.bindPopup("Konumunuz");
    return;
  }

  userMarker.setLatLng(position);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  renderMode();
  if (state.activeTab === "events") {
    renderEvents();
    return;
  }

  const stations = filteredStations();
  renderFilters();
  renderList(stations);
  renderMap(stations);
  renderLocationStatus();
}

function renderMode() {
  const eventsMode = state.activeTab === "events";
  els.shell.classList.toggle("events-mode", eventsMode);
  els.stationsTab.classList.toggle("active", !eventsMode);
  els.eventsTab.classList.toggle("active", eventsMode);
  els.stationControls.hidden = eventsMode;
  els.searchPanel.hidden = eventsMode || !state.searchOpen;
  els.filterPanel.hidden = eventsMode || !state.filterOpen;
  els.locationStatus.hidden = eventsMode;
  els.mapPanel.hidden = eventsMode;
  els.stationResults.hidden = eventsMode;
  els.eventControls.hidden = !eventsMode;
  els.eventResults.hidden = !eventsMode;
  els.pageTitle.textContent = eventsMode ? "Etkinlikler" : "Şarj İstasyonları";
  els.totalLabel.textContent = eventsMode ? "etkinlik" : "istasyon";
}

function filteredEvents() {
  const query = normalizeText(state.eventQuery);
  return state.events.filter((event) => {
    if (!query) return true;
    return normalizeText([
      event.title,
      event.venueName,
      event.address,
      event.category,
    ].join(" ")).includes(query);
  });
}

function renderEvents() {
  const events = filteredEvents();
  els.totalCount.textContent = state.events.length;
  els.eventCount.textContent = `${events.length} kayıt`;

  if (!events.length) {
    const message = state.eventMeta?.enabled
      ? "Etkinlik bulunamadı."
      : "Etkinlik entegrasyonu hazır. Admin panelinden API ayarını açıp token ile senkronize edin.";
    els.eventList.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
    return;
  }

  els.eventList.innerHTML = events.map((event) => `
    <article class="event-card">
      <div class="meta-row">
        ${event.category ? `<span>${escapeHtml(event.category)}</span>` : ""}
        ${event.startsAt ? `<span>${escapeHtml(formatEventDate(event.startsAt))}</span>` : ""}
      </div>
      <h3>${escapeHtml(event.title)}</h3>
      <p>${escapeHtml([event.venueName, event.address].filter(Boolean).join(" - "))}</p>
      ${event.sourceUrl ? `<a class="event-source" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noopener">Detay</a>` : ""}
    </article>
  `).join("");
}

function formatEventDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function focusMapPanel() {
  window.setTimeout(() => {
    map.invalidateSize();
    if (!els.mapPanel || isMostlyVisible(els.mapPanel)) return;
    els.mapPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 0);
}

function isMostlyVisible(element) {
  const rect = element.getBoundingClientRect();
  const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return visibleHeight >= Math.min(rect.height * 0.65, window.innerHeight * 0.65);
}

function renderLocationStatus() {
  if (state.locating) {
    els.locationStatus.textContent = "Konum hassaslaştırılıyor...";
    els.locateButton.textContent = "Konum alınıyor";
    return;
  }

  if (!state.userLocation) {
    els.locationStatus.textContent = "Konum kapalı. En yakın istasyonlar için izin verin.";
    els.locateButton.textContent = "Konumumu kullan";
    return;
  }

  const accuracy = Number(state.userAccuracy);
  const accuracyText = Number.isFinite(accuracy) ? ` Doğruluk: yaklaşık ${Math.round(accuracy)} m.` : "";
  const warning = Number.isFinite(accuracy) && accuracy > 1000
    ? " Konum geniş bir alandan geliyor; telefonda GPS açıkken daha doğru olur."
    : "";
  els.locationStatus.textContent = `Konum açık. Liste en yakından uzağa sıralanıyor.${accuracyText}${warning}`;
  els.locateButton.textContent = "Konumu yenile";
}

async function loadStations() {
  initMap();
  const data = await fetchStations();
  state.stations = data.stations || data.data || [];
  state.meta = data.meta || {
    city: data.city || "Mersin",
    generatedAt: data.generatedAt || null,
    totalStations: data.stationCount || state.stations.length,
    returnedStations: state.stations.length,
  };
  state.meta.totalStations = state.meta.totalStations || state.meta.total || state.stations.length;
  state.districts = data.districts || buildDistricts(state.stations);
  await loadEvents();
  render();
}

async function fetchStations() {
  let lastError = null;

  for (const url of API_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("stations_api_failed");
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("stations_api_failed");
}

async function loadEvents() {
  let lastError = null;

  for (const url of EVENT_API_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("events_api_failed");
      const data = await response.json();
      state.events = data.events || data.data || [];
      state.eventMeta = data.meta || data.config || null;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  state.events = [];
  state.eventMeta = { enabled: false, error: lastError?.message || "events_api_failed" };
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

function requestLocation() {
  if (!navigator.geolocation) {
    els.locationStatus.textContent = "Bu cihaz konum özelliğini desteklemiyor.";
    return;
  }

  stopLocationWatch();
  state.locating = true;
  renderLocationStatus();

  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      updateUserLocation(position);
      if (Number(position.coords.accuracy) <= 100) {
        stopLocationWatch();
        state.locating = false;
        render();
      }
    },
    () => {
      els.locationStatus.textContent = "Konum izni alınamadı. Tarayıcı iznini kontrol edin.";
      state.locating = false;
      stopLocationWatch();
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    }
  );

  locationTimeoutId = window.setTimeout(() => {
    stopLocationWatch();
    state.locating = false;
    render();
  }, 15000);
}

function updateUserLocation(position) {
  state.userLocation = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  };
  state.userAccuracy = position.coords.accuracy;
  state.nearestMode = true;
  state.focusedStationNo = "";
  clearRoute();
  render();
}

function stopLocationWatch() {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }

  if (locationTimeoutId !== null) {
    window.clearTimeout(locationTimeoutId);
    locationTimeoutId = null;
  }
}

async function drawRoute(stationNo) {
  if (!state.userLocation) {
    requestLocation();
    return;
  }

  const station = state.stations.find((item) => item.stationNo === stationNo);
  if (!station || !stationHasLocation(station)) return;

  state.focusedStationNo = station.stationNo;
  state.routeStationNo = station.stationNo;
  els.routeSummary.textContent = "Rota hesaplanıyor...";
  render();
  focusMapPanel();

  const { lat, lng } = stationCoordinates(station);
  const start = `${state.userLocation.lng},${state.userLocation.lat}`;
  const end = `${lng},${lat}`;
  const url = `${ROUTE_API_URL}/${encodeURIComponent(start)};${encodeURIComponent(end)}?overview=full&geometries=geojson&alternatives=false&steps=false`;

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("route_failed");
    const data = await response.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates) throw new Error("route_missing");

    if (routeLayer) {
      map.removeLayer(routeLayer);
    }

    const latLngs = route.geometry.coordinates.map(([routeLng, routeLat]) => [routeLat, routeLng]);
    routeLayer = L.polyline(latLngs, {
      color: MAP_COLORS.route,
      weight: 5,
      opacity: 0.88,
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [38, 38] });
    els.mapLabel.textContent = station.name;
    els.mapSummary.textContent = `${formatDistance(route.distance / 1000)} · ${formatDuration(route.duration)}`;
    els.routeSummary.textContent = `${station.name}: ${formatDistance(route.distance / 1000)}, ${formatDuration(route.duration)}`;
  } catch {
    els.routeSummary.textContent = "Rota hesaplanamadı. Biraz sonra tekrar deneyin.";
  }
}

function clearRoute() {
  state.routeStationNo = "";
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  els.routeSummary.textContent = "Rota seçilmedi";
}

els.districtSelect.addEventListener("change", (event) => {
  state.district = event.target.value;
  state.focusedStationNo = "";
  render();
});

els.brandSelect.addEventListener("change", (event) => {
  state.brand = event.target.value;
  state.focusedStationNo = "";
  render();
});

els.socketSelect.addEventListener("change", (event) => {
  state.socket = event.target.value;
  state.focusedStationNo = "";
  render();
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.focusedStationNo = "";
  render();
});

els.searchToggle.addEventListener("click", () => {
  state.searchOpen = !state.searchOpen;
  if (state.searchOpen) state.filterOpen = false;
  renderToolPanels();
  if (state.searchOpen) els.searchInput.focus();
});

els.filterToggle.addEventListener("click", () => {
  state.filterOpen = !state.filterOpen;
  if (state.filterOpen) state.searchOpen = false;
  renderToolPanels();
});

els.locateButton.addEventListener("click", () => {
  requestLocation();
});

els.clearRoute.addEventListener("click", () => {
  clearRoute();
  state.focusedStationNo = "";
  render();
});

els.stationList.addEventListener("click", (event) => {
  const routeButton = event.target.closest("button[data-route-station]");
  if (routeButton) {
    drawRoute(routeButton.dataset.routeStation);
    return;
  }

  const mapButton = event.target.closest("button[data-map-station]");
  if (mapButton) {
    state.focusedStationNo = mapButton.dataset.mapStation;
    render();
    focusMapPanel();
  }
});

els.stationsTab.addEventListener("click", () => {
  state.activeTab = "stations";
  render();
  window.setTimeout(() => map.invalidateSize(), 0);
});

els.eventsTab.addEventListener("click", () => {
  state.activeTab = "events";
  render();
});

els.eventSearchInput.addEventListener("input", (event) => {
  state.eventQuery = event.target.value;
  renderEvents();
});

loadStations().catch(() => {
  els.stationList.innerHTML = `<div class="empty">Veri yüklenemedi.</div>`;
});
