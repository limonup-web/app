const API_URLS = ["/api/v1/stations", "data/stations.json"];
const EVENT_API_URLS = ["/api/v1/events", "data/events.json"];
const TAXI_TARIFF_URLS = ["/api/v1/taxi/tariff", "data/taxi-tariff.json"];
const TAXI_ESTIMATE_URL = "/api/v1/taxi/estimate";
const TAXI_GEOCODE_URL = "/api/v1/taxi/geocode";
const TAXI_ROUTE_URL = "/api/v1/taxi/route";
const ROUTE_API_URL = "https://router.project-osrm.org/route/v1/driving";
const MERSIN_CENTER = [36.8121, 34.6415];
const MAP_COLORS = {
  station: "#54a536",
  user: "#2f7d22",
  route: "#2f7d22",
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
  taxiTariff: null,
  taxiEstimate: null,
  taxiStart: null,
  taxiEnd: null,
  taxiRoute: null,
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
  taxiTab: document.querySelector("#taxiTab"),
  stationControls: document.querySelector("#stationControls"),
  eventControls: document.querySelector("#eventControls"),
  taxiControls: document.querySelector("#taxiControls"),
  stationResults: document.querySelector("#stationResults"),
  eventResults: document.querySelector("#eventResults"),
  taxiResults: document.querySelector("#taxiResults"),
  totalsBox: document.querySelector(".totals"),
  eventSearchInput: document.querySelector("#eventSearchInput"),
  eventCount: document.querySelector("#eventCount"),
  eventList: document.querySelector("#eventList"),
  taxiStartInput: document.querySelector("#taxiStartInput"),
  taxiEndInput: document.querySelector("#taxiEndInput"),
  taxiUseLocationButton: document.querySelector("#taxiUseLocationButton"),
  taxiTariffDate: document.querySelector("#taxiTariffDate"),
  taxiFareValue: document.querySelector("#taxiFareValue"),
  taxiOpeningValue: document.querySelector("#taxiOpeningValue"),
  taxiDistanceFeeValue: document.querySelector("#taxiDistanceFeeValue"),
  taxiRouteValue: document.querySelector("#taxiRouteValue"),
  taxiMinimumValue: document.querySelector("#taxiMinimumValue"),
  taxiMinimumNote: document.querySelector("#taxiMinimumNote"),
  taxiNotice: document.querySelector("#taxiNotice"),
};

let map;
let markersLayer;
let userMarker;
let userAccuracyCircle;
let routeLayer;
let taxiLayer;
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
  taxiLayer = L.layerGroup().addTo(map);
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
  taxiLayer.clearLayers();
  if (routeLayer && !state.routeStationNo) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
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

  if (state.activeTab === "taxi") {
    renderTaxi();
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
  const taxiMode = state.activeTab === "taxi";
  const detailMode = eventsMode || taxiMode;
  els.shell.classList.toggle("events-mode", eventsMode);
  els.stationsTab.classList.toggle("active", !detailMode);
  els.eventsTab.classList.toggle("active", eventsMode);
  els.taxiTab.classList.toggle("active", taxiMode);
  els.stationControls.hidden = detailMode;
  els.searchPanel.hidden = detailMode || !state.searchOpen;
  els.filterPanel.hidden = detailMode || !state.filterOpen;
  els.locationStatus.hidden = detailMode;
  els.mapPanel.hidden = eventsMode;
  els.stationResults.hidden = detailMode;
  els.eventControls.hidden = !eventsMode;
  els.eventResults.hidden = !eventsMode;
  els.taxiControls.hidden = !taxiMode;
  els.taxiResults.hidden = !taxiMode;
  els.totalsBox.hidden = taxiMode;
  els.pageTitle.textContent = taxiMode ? "Taksi Hesaplama" : eventsMode ? "Etkinlikler" : "Şarj İstasyonları";
  els.totalLabel.textContent = taxiMode ? "taksi" : eventsMode ? "etkinlik" : "istasyon";
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

function renderTaxi() {
  renderTaxiMap();
  els.taxiTariffDate.textContent = state.taxiTariff?.updatedAt
    ? `Güncelleme: ${formatShortDate(state.taxiTariff.updatedAt)}`
    : "Tarife yükleniyor";

  const tariff = state.taxiTariff;
  if (!tariff) {
    els.taxiNotice.textContent = "Tarife yükleniyor.";
    return;
  }

  els.taxiMinimumValue.textContent = `Kısa mesafe: ${formatMoney(tariff.minimumFare)}`;
  els.taxiNotice.textContent = tariff.notice || "Tahmini sonuçtur, kesin ücret değildir.";

  if (!state.taxiEstimate) {
    els.taxiFareValue.textContent = "-";
    els.taxiOpeningValue.textContent = `Açılış: ${formatMoney(tariff.openingFee)}`;
    els.taxiDistanceFeeValue.textContent = `Km ücreti: ${formatMoney(tariff.perKmFee)}`;
    els.taxiRouteValue.textContent = "Rota: -";
    els.taxiMinimumNote.textContent = "Kalkış ve varış girince rota mesafesine göre tahmini ücret hesaplanır.";
    return;
  }

  const estimate = state.taxiEstimate;
  els.taxiFareValue.textContent = formatMoney(estimate.fare.amount);
  els.taxiOpeningValue.textContent = `Açılış: ${formatMoney(estimate.fare.openingFee)}`;
  els.taxiDistanceFeeValue.textContent = `Mesafe: ${formatMoney(estimate.fare.distanceFee)} (${formatDistance(estimate.distanceKm)})`;
  els.taxiRouteValue.textContent = estimate.durationSeconds
    ? `Rota: ${formatDuration(estimate.durationSeconds)}`
    : "Rota: hesaplandı";
  els.taxiMinimumNote.textContent = estimate.fare.minimumApplied
    ? "Hesaplanan tutar kısa mesafe ücretinin altında kaldığı için kısa mesafe ücreti uygulandı."
    : "";
}

function renderTaxiMap() {
  markersLayer.clearLayers();
  taxiLayer.clearLayers();
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  const bounds = [];
  if (state.taxiStart) {
    addTaxiPointMarker("start", state.taxiStart);
    bounds.push([state.taxiStart.lat, state.taxiStart.lng]);
  }

  if (state.taxiEnd) {
    addTaxiPointMarker("end", state.taxiEnd);
    bounds.push([state.taxiEnd.lat, state.taxiEnd.lng]);
  }

  if (state.taxiRoute?.geometry?.coordinates?.length) {
    const latLngs = state.taxiRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    routeLayer = L.polyline(latLngs, {
      color: MAP_COLORS.route,
      weight: 5,
      opacity: 0.88,
    }).addTo(taxiLayer);
    routeLayer.getLatLngs().forEach((point) => bounds.push([point.lat, point.lng]));
  }

  els.mapLabel.textContent = "Taksi rotası";
  els.mapSummary.textContent = state.taxiEstimate
    ? `${formatDistance(state.taxiEstimate.distanceKm)} · ${formatDuration(state.taxiEstimate.durationSeconds)}`
    : "Kalkış ve varış girin";
  els.routeSummary.textContent = state.taxiEstimate
    ? `Tahmini taksi: ${formatMoney(state.taxiEstimate.fare.amount)}`
    : "Taksi rotası seçilmedi";

  window.setTimeout(() => {
    map.invalidateSize();
    if (bounds.length >= 2) map.fitBounds(bounds, { padding: [42, 42], maxZoom: 15 });
    else if (bounds.length === 1) map.setView(bounds[0], 15);
    else map.setView(MERSIN_CENTER, 11);
  }, 0);
}

function addTaxiPointMarker(type, point) {
  const marker = L.marker([point.lat, point.lng], {
    icon: L.divIcon({
      className: `taxi-point-marker taxi-point-${type}`,
      html: `<span><b>${type === "start" ? "A" : "B"}</b></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -30],
    }),
  }).addTo(taxiLayer);
  marker.bindPopup(`<strong>${type === "start" ? "Kalkış" : "Varış"}</strong><br>${escapeHtml(point.label || "")}`);
}

async function calculateTaxiFare(event) {
  event.preventDefault();
  const startQuery = els.taxiStartInput.value.trim();
  const endQuery = els.taxiEndInput.value.trim();
  if (!startQuery || !endQuery) {
    els.taxiMinimumNote.textContent = "Kalkış ve varış alanlarını doldurun.";
    return;
  }

  try {
    els.taxiMinimumNote.textContent = "Adresler ve rota hesaplanıyor...";
    const [start, end] = await Promise.all([
      resolveTaxiPoint(startQuery),
      resolveTaxiPoint(endQuery),
    ]);
    const route = await fetchTaxiRoute(start, end);
    const response = await fetch(TAXI_ESTIMATE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ distanceKm: route.distanceKm }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "taxi_estimate_failed");
    state.taxiEstimate = data.estimate || data.data;
    state.taxiEstimate.durationSeconds = route.durationSeconds;
    state.taxiStart = start;
    state.taxiEnd = end;
    state.taxiRoute = route;
    state.taxiTariff = data.tariff || state.taxiTariff;
    renderTaxi();
  } catch (error) {
    const tariff = state.taxiTariff;
    if (tariff) {
      state.taxiEstimate = null;
      state.taxiRoute = null;
      renderTaxi();
    }
    els.taxiMinimumNote.textContent = error.message || "Rota hesaplanamadı. Adresleri biraz daha net yazın.";
  }
}

async function resolveTaxiPoint(query) {
  const coordinate = parseCoordinatePair(query);
  if (coordinate) return { ...coordinate, label: query };

  const url = new URL(TAXI_GEOCODE_URL, window.location.origin);
  url.searchParams.set("q", query);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Adres aranamadı.");
  const point = data.point || data.data;
  if (!point) throw new Error(`Adres bulunamadı: ${query}`);
  return point;
}

async function fetchTaxiRoute(start, end) {
  const response = await fetch(TAXI_ROUTE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ start, end }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Rota hesaplanamadı.");
  return data.route;
}

function parseCoordinatePair(value) {
  const match = String(value || "").trim().match(/^(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1].replace(",", "."));
  const lng = Number(match[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 35 || lat > 38 || lng < 32 || lng > 36) return null;
  return { lat, lng };
}

function debounce(fn, delay) {
  let timerId;
  return (...args) => {
    window.clearTimeout(timerId);
    timerId = window.setTimeout(() => fn(...args), delay);
  };
}

async function previewTaxiPoint(type) {
  const input = type === "start" ? els.taxiStartInput : els.taxiEndInput;
  const query = input.value.trim();
  if (query.length < 3) return;
  if (!query) return;
  try {
    const point = await resolveTaxiPoint(query);
    state[type === "start" ? "taxiStart" : "taxiEnd"] = point;
    state.taxiEstimate = null;
    state.taxiRoute = null;
    renderTaxi();
  } catch (error) {
    els.taxiMinimumNote.textContent = error.message || "Konum bulunamadı.";
  }
}

function buildTaxiEstimate(distanceKmValue, tariff) {
  const distanceFee = distanceKmValue * Number(tariff.perKmFee || 0);
  const calculated = Number(tariff.openingFee || 0) + distanceFee;
  const amount = Math.max(Number(tariff.minimumFare || 0), calculated);
  const roundTo = Number(tariff.roundTo || 1);
  return {
    distanceKm: distanceKmValue,
    fare: {
      amount: roundMoney(amount, roundTo),
      openingFee: Number(tariff.openingFee || 0),
      distanceFee: roundMoney(distanceFee, roundTo),
      minimumApplied: amount > calculated,
    },
  };
}

function roundMoney(value, roundTo) {
  if (!Number.isFinite(roundTo) || roundTo <= 0) return Math.round(value);
  return Math.round(value / roundTo) * roundTo;
}

function formatMoney(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
  }).format(Number(value));
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
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
  await loadTaxiTariff();
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

async function loadTaxiTariff() {
  let lastError = null;

  for (const url of TAXI_TARIFF_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("taxi_tariff_failed");
      const data = await response.json();
      state.taxiTariff = data.tariff || data.data || data;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  state.taxiTariff = {
    openingFee: 0,
    perKmFee: 0,
    minimumFare: 0,
    roundTo: 1,
    notice: lastError?.message || "Tarife yüklenemedi.",
  };
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
  state.taxiRoute = null;
  state.taxiEstimate = null;
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  taxiLayer.clearLayers();
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

els.taxiTab.addEventListener("click", () => {
  state.activeTab = "taxi";
  render();
});

els.eventSearchInput.addEventListener("input", (event) => {
  state.eventQuery = event.target.value;
  renderEvents();
});

const previewTaxiStart = debounce(() => previewTaxiPoint("start"), 800);
const previewTaxiEnd = debounce(() => previewTaxiPoint("end"), 800);

els.taxiControls.addEventListener("submit", calculateTaxiFare);
els.taxiStartInput.addEventListener("input", previewTaxiStart);
els.taxiEndInput.addEventListener("input", previewTaxiEnd);
els.taxiStartInput.addEventListener("change", () => previewTaxiPoint("start"));
els.taxiEndInput.addEventListener("change", () => previewTaxiPoint("end"));

els.taxiUseLocationButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    els.taxiMinimumNote.textContent = "Bu cihaz konum özelliğini desteklemiyor.";
    return;
  }

  els.taxiMinimumNote.textContent = "Konum alınıyor...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      els.taxiStartInput.value = `${lat}, ${lng}`;
      state.taxiStart = { lat: Number(lat), lng: Number(lng), label: "Mevcut konum" };
      state.taxiEstimate = null;
      state.taxiRoute = null;
      renderTaxi();
      els.taxiMinimumNote.textContent = "Kalkış konumunuz olarak ayarlandı.";
    },
    () => {
      els.taxiMinimumNote.textContent = "Konum izni alınamadı.";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
});

loadStations().catch(() => {
  els.stationList.innerHTML = `<div class="empty">Veri yüklenemedi.</div>`;
});
