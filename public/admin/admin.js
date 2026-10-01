const state = {
  stations: [],
  selectedStationNo: "",
  query: "",
  status: "all",
};

const els = {
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  resultCount: document.querySelector("#resultCount"),
  storageBadge: document.querySelector("#storageBadge"),
  stationList: document.querySelector("#stationList"),
  form: document.querySelector("#stationForm"),
  editorTitle: document.querySelector("#editorTitle"),
  saveButton: document.querySelector("#saveButton"),
  formStatus: document.querySelector("#formStatus"),
  newStationButton: document.querySelector("#newStationButton"),
  logoutButton: document.querySelector("#logoutButton"),
  coordinatePaste: document.querySelector("#coordinatePaste"),
  loginPanel: document.querySelector("#loginPanel"),
  adminContent: document.querySelector("#adminContent"),
  loginForm: document.querySelector("#loginForm"),
  loginStatus: document.querySelector("#loginStatus"),
  adminStationsTab: document.querySelector("#adminStationsTab"),
  adminEventsTab: document.querySelector("#adminEventsTab"),
  stationsAdminView: document.querySelector("#stationsAdminView"),
  eventsAdminView: document.querySelector("#eventsAdminView"),
  eventsSettingsForm: document.querySelector("#eventsSettingsForm"),
  syncEventsButton: document.querySelector("#syncEventsButton"),
  eventsAdminStatus: document.querySelector("#eventsAdminStatus"),
};

function normalizeText(value) {
  return String(value || "").toLocaleLowerCase("tr-TR");
}

function filteredStations() {
  const query = normalizeText(state.query);
  return state.stations.filter((station) => {
    if (state.status !== "all" && station.locationStatus !== state.status) return false;
    if (!query) return true;
    return normalizeText([
      station.stationNo,
      station.name,
      station.brand,
      station.district,
      station.address,
    ].join(" ")).includes(query);
  });
}

function renderList() {
  const stations = filteredStations();
  els.resultCount.textContent = `${stations.length} kayıt`;
  els.stationList.innerHTML = stations.map((station) => `
    <button class="station-item${station.stationNo === state.selectedStationNo ? " active" : ""}" type="button" data-station-no="${escapeHtml(station.stationNo)}">
      <strong>${escapeHtml(station.name || station.stationNo)}</strong>
      <span>${escapeHtml([station.district, station.brand, station.stationNo].filter(Boolean).join(" - "))}</span>
      <span class="status-pill">${statusLabel(station.locationStatus)}</span>
    </button>
  `).join("");
}

function statusLabel(status) {
  return {
    verified: "Doğrulanmış",
    unverified: "Doğrulanmamış",
    missing: "Konum yok",
    rejected: "Hatalı",
  }[status] || "Bilinmiyor";
}

function selectStation(stationNo) {
  const station = state.stations.find((item) => item.stationNo === stationNo);
  if (!station) return;
  state.selectedStationNo = station.stationNo;
  fillForm(station);
  renderList();
}

function fillForm(station) {
  els.editorTitle.textContent = station.name || station.stationNo;
  setField("stationNo", station.stationNo || "");
  setField("name", station.name || "");
  setField("brand", station.brand || "");
  setField("district", station.district || "");
  setField("address", station.address || "");
  setField("latitude", station.latitude ?? "");
  setField("longitude", station.longitude ?? "");
  setField("locationStatus", station.locationStatus || "unverified");
  setField("verificationSource", station.verificationSource || station.geocodeProvider || "");
  setField("verificationNote", station.verificationNote || "");
  setField("sockets", JSON.stringify(station.sockets || [], null, 2));
  setStatus("Düzenlemeyi yaptıktan sonra Kaydet'e basın.");
}

function setField(name, value) {
  els.form.elements[name].value = value;
}

function newStation() {
  state.selectedStationNo = "";
  els.editorTitle.textContent = "Yeni istasyon";
  els.form.reset();
  setField("stationNo", `MANUAL/${Date.now()}`);
  setField("locationStatus", "unverified");
  setField("sockets", "[]");
  setStatus("Yeni kayıt bilgilerini girin.");
  renderList();
}

function stationFromForm() {
  const form = new FormData(els.form);
  return {
    stationNo: String(form.get("stationNo") || "").trim(),
    name: String(form.get("name") || "").trim(),
    brand: String(form.get("brand") || "").trim(),
    district: String(form.get("district") || "").trim(),
    address: String(form.get("address") || "").trim(),
    latitude: String(form.get("latitude") || "").trim(),
    longitude: String(form.get("longitude") || "").trim(),
    locationStatus: String(form.get("locationStatus") || "unverified"),
    verificationSource: String(form.get("verificationSource") || "").trim(),
    verificationNote: String(form.get("verificationNote") || "").trim(),
    sockets: JSON.parse(String(form.get("sockets") || "[]")),
  };
}

async function saveStation(event) {
  event.preventDefault();
  setStatus("Kaydediliyor...");
  els.saveButton.disabled = true;

  try {
    const payload = stationFromForm();
    const isExisting = state.stations.some((station) => station.stationNo === payload.stationNo);
    const url = isExisting ? `/api/admin/stations/${encodeURIComponent(payload.stationNo)}` : "/api/admin/stations";
    const response = await fetch(url, {
      method: isExisting ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "save_failed");

    const index = state.stations.findIndex((station) => station.stationNo === data.data.stationNo);
    if (index >= 0) state.stations[index] = data.data;
    else state.stations.unshift(data.data);
    state.selectedStationNo = data.data.stationNo;
    fillForm(data.data);
    renderList();
    setStatus("Kaydedildi.", "success");
  } catch (error) {
    if (error.message === "admin_auth_required") {
      showLogin("Oturum süresi doldu. Tekrar giriş yapın.");
      return;
    }
    setStatus(`Kaydedilemedi: ${error.message}`, "error");
  } finally {
    els.saveButton.disabled = false;
  }
}

function showLogin(message = "Düzenleme için giriş yapın.") {
  els.loginPanel.hidden = false;
  els.adminContent.hidden = true;
  els.logoutButton.hidden = true;
  els.newStationButton.hidden = true;
  els.loginStatus.textContent = message;
  els.loginStatus.className = "form-status";
  els.loginForm.elements.password.focus();
}

function showAdmin() {
  els.loginPanel.hidden = true;
  els.adminContent.hidden = false;
  els.logoutButton.hidden = false;
  els.newStationButton.hidden = false;
}

function setAdminView(view) {
  const events = view === "events";
  els.adminStationsTab.classList.toggle("active", !events);
  els.adminEventsTab.classList.toggle("active", events);
  els.stationsAdminView.hidden = events;
  els.eventsAdminView.hidden = !events;
  els.newStationButton.hidden = events;
  if (events) loadEventsSettings();
}

async function login(event) {
  event.preventDefault();
  els.loginStatus.textContent = "Kontrol ediliyor...";

  const password = String(new FormData(els.loginForm).get("password") || "");
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    els.loginStatus.textContent = "Şifre hatalı.";
    els.loginStatus.className = "form-status error";
    return;
  }

  els.loginForm.reset();
  showAdmin();
  await loadStations();
}

async function logout() {
  await fetch("/api/admin/logout", { method: "POST" });
  state.stations = [];
  state.selectedStationNo = "";
  renderList();
  showLogin("Çıkış yapıldı.");
}

async function loadEventsSettings() {
  const response = await fetch("/api/admin/events/settings", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) {
    els.eventsAdminStatus.textContent = `Etkinlik ayarı yüklenemedi: ${data.error || "hata"}`;
    els.eventsAdminStatus.className = "form-status error";
    return;
  }

  const config = data.config || {};
  els.eventsSettingsForm.elements.enabled.value = String(Boolean(config.enabled));
  els.eventsSettingsForm.elements.city.value = config.city || "Mersin";
  els.eventsSettingsForm.elements.baseUrl.value = config.baseUrl || "https://etkinlik.io/api/v2/events";
  els.eventsSettingsForm.elements.limit.value = config.limit || 50;
  els.eventsSettingsForm.elements.apiToken.value = "";
  els.eventsAdminStatus.textContent = config.hasToken
    ? `Token var. Son senkron: ${config.lastSyncedAt || "henüz yok"}.`
    : "Token yok. API anahtarını girip ayarı kaydedin.";
  els.eventsAdminStatus.className = "form-status";
}

async function saveEventsSettings(event) {
  event.preventDefault();
  const form = new FormData(els.eventsSettingsForm);
  const payload = {
    enabled: form.get("enabled") === "true",
    city: String(form.get("city") || "Mersin").trim(),
    baseUrl: String(form.get("baseUrl") || "").trim(),
    limit: Number(form.get("limit") || 50),
    apiToken: String(form.get("apiToken") || "").trim(),
  };
  const response = await fetch("/api/admin/events/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    els.eventsAdminStatus.textContent = `Kaydedilemedi: ${data.error || "hata"}`;
    els.eventsAdminStatus.className = "form-status error";
    return;
  }
  els.eventsSettingsForm.elements.apiToken.value = "";
  els.eventsAdminStatus.textContent = data.config?.hasToken
    ? "Etkinlik ayarı kaydedildi. Token var."
    : "Etkinlik ayarı kaydedildi. Token yok.";
  els.eventsAdminStatus.className = "form-status success";
}

async function syncEvents() {
  els.eventsAdminStatus.textContent = "Etkinlikler çekiliyor...";
  const response = await fetch("/api/admin/events/sync", { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    els.eventsAdminStatus.textContent = data.error === "etkinlik_token_missing"
      ? "Token yok. Etkinlik API anahtarını girip ayarı kaydedin."
      : `Senkronizasyon olmadı: ${data.error || "hata"}`;
    els.eventsAdminStatus.className = "form-status error";
    return;
  }
  els.eventsAdminStatus.textContent = `${data.count} etkinlik senkronize edildi.`;
  els.eventsAdminStatus.className = "form-status success";
}

function setStatus(message, type = "") {
  els.formStatus.textContent = message;
  els.formStatus.className = `form-status ${type}`.trim();
}

function parseCoordinates() {
  const coordinates = extractCoordinates(els.coordinatePaste.value);
  if (!coordinates) {
    setStatus("Koordinat bulunamadı. Google Maps tam linkini veya enlem, boylam değerini yapıştırın.", "error");
    return;
  }

  setField("latitude", coordinates.lat);
  setField("longitude", coordinates.lng);
  els.coordinatePaste.value = "";
  setStatus("Koordinat alanları dolduruldu. Kaydet'e basınca kayıt güncellenir.", "success");
}

function extractCoordinates(value) {
  const input = String(value || "").trim();
  if (!input) return null;

  const decoded = safeDecode(input);
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[,/?]|$)/,
    /[?&](?:query|q|ll|center|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[&/]|$)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    const coordinates = coordinatesFromMatch(match);
    if (coordinates) return coordinates;
  }

  const plainPair = decoded.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return coordinatesFromMatch(plainPair);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function coordinatesFromMatch(match) {
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!isMersinCoordinate(lat, lng)) return null;
  return {
    lat: String(lat),
    lng: String(lng),
  };
}

function isMersinCoordinate(lat, lng) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= 35
    && lat <= 38
    && lng >= 32
    && lng <= 36;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function load() {
  const health = await fetch("/api/v1/health", { cache: "no-store" }).then((response) => response.json());
  els.storageBadge.textContent = health.storage === "d1" ? "Canlı DB" : "Yerel JSON";

  const session = await fetch("/api/admin/me", { cache: "no-store" }).then((response) => response.json());
  if (!session.authenticated) {
    showLogin();
    return;
  }

  showAdmin();
  await loadStations();
}

async function loadStations() {
  const response = await fetch("/api/admin/stations", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "load_failed");
  state.stations = data.data || [];
  renderList();
  if (state.stations[0]) selectStation(state.stations[0].stationNo);
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});

els.statusFilter.addEventListener("change", (event) => {
  state.status = event.target.value;
  renderList();
});

els.stationList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-station-no]");
  if (button) selectStation(button.dataset.stationNo);
});

els.newStationButton.addEventListener("click", newStation);
els.logoutButton.addEventListener("click", logout);
els.adminStationsTab.addEventListener("click", () => setAdminView("stations"));
els.adminEventsTab.addEventListener("click", () => setAdminView("events"));
els.eventsSettingsForm.addEventListener("submit", saveEventsSettings);
els.syncEventsButton.addEventListener("click", syncEvents);
els.loginForm.addEventListener("submit", login);
els.form.addEventListener("submit", saveStation);
els.coordinatePaste.addEventListener("change", parseCoordinates);
els.coordinatePaste.addEventListener("paste", () => window.setTimeout(parseCoordinates, 0));

load().catch((error) => {
  els.storageBadge.textContent = "Erişim yok";
  if (error.message === "admin_auth_required") {
    showLogin();
    return;
  }
  showLogin(`Panel yüklenemedi: ${error.message}`);
});
