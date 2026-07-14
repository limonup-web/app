const API_URL = "data/stations.json";
const ROUTE_API_URL = "https://router.project-osrm.org/route/v1/driving";
const MERSIN_CENTER = [36.8121, 34.6415];
const MAP_COLORS = {
  station: "#c73532",
  stationActive: "#ffd166",
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

function stationHasVerifiedLocation(station) {
  return stationHasLocation(station)
    && !["mymaps-viewer", "viewer-search"].includes(String(station.geocodeQuality || ""));
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
    if (!state.userLocation || !stationHasVerifiedLocation(station)) {
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
    const locationBadge = stationHasVerifiedLocation(station)
      ? `<span class="location-ok">Konum doğrulandı</span>`
      : `<span class="location-warn">Konum doğrulanmalı</span>`;
    const routeButton = state.userLocation && stationHasVerifiedLocation(station)
      ? `<button type="button" data-route-station="${escapeHtml(station.stationNo)}">Rota çiz</button>`
      : "";
    const mapButton = stationHasVerifiedLocation(station)
      ? `<button type="button" class="primary" data-map-station="${escapeHtml(station.stationNo)}">Haritada göster</button>`
      : `<button type="button" class="primary" disabled>Konum belirsiz</button>`;

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
          ${locationBadge}
          ${distance}
        </div>
        <div class="actions">
          ${mapButton}
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

  const locatedStations = stations.filter(stationHasVerifiedLocation);
  const bounds = [];

  locatedStations.forEach((station) => {
    const { lat, lng } = stationCoordinates(station);
    const marker = L.circleMarker([lat, lng], {
      radius: station.stationNo === state.focusedStationNo ? 8 : 6,
      color: station.stationNo === state.focusedStationNo ? MAP_COLORS.stationActive : MAP_COLORS.station,
      fillColor: station.stationNo === state.focusedStationNo ? MAP_COLORS.stationActive : MAP_COLORS.station,
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

  if (state.userLocation) {
    renderUserMarker();
    bounds.push([state.userLocation.lat, state.userLocation.lng]);
  }

  const focusedStation = state.stations.find((station) => station.stationNo === state.focusedStationNo);
  if (focusedStation && stationHasVerifiedLocation(focusedStation)) {
    const { lat, lng } = stationCoordinates(focusedStation);
    map.setView([lat, lng], 16);
    els.mapLabel.textContent = focusedStation.name;
    els.mapSummary.textContent = summaryText(focusedStation);
    return;
  }

  if (routeLayer) {
    els.mapLabel.textContent = "Rota";
    return;
  }

  els.mapLabel.textContent = state.nearestMode ? "Yakındaki İstasyonlar" : "Mersin Haritası";
  els.mapSummary.textContent = `${locatedStations.length} doğrulanmış konum gösteriliyor`;

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
  const stations = filteredStations();
  renderFilters();
  renderList(stations);
  renderMap(stations);
  renderLocationStatus();
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
  const response = await fetch(API_URL, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("stations_api_failed");
  const data = await response.json();
  state.stations = data.stations || [];
  state.meta = data.meta || {
    city: data.city || "Mersin",
    generatedAt: data.generatedAt || null,
    totalStations: data.stationCount || state.stations.length,
    returnedStations: state.stations.length,
  };
  state.districts = data.districts || buildDistricts(state.stations);
  render();
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
  if (!station || !stationHasVerifiedLocation(station)) return;

  state.focusedStationNo = station.stationNo;
  state.routeStationNo = station.stationNo;
  els.routeSummary.textContent = "Rota hesaplanıyor...";
  render();

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
  }
});

loadStations().catch(() => {
  els.stationList.innerHTML = `<div class="empty">Veri yüklenemedi.</div>`;
});
