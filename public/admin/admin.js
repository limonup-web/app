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
  coordinatePaste: document.querySelector("#coordinatePaste"),
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
    setStatus(error.message === "admin_auth_required"
      ? "Bu ekran için yetki alınamadı. Siteye giriş yaptığınız kullanıcıyı kontrol edin."
      : `Kaydedilemedi: ${error.message}`, "error");
  } finally {
    els.saveButton.disabled = false;
  }
}

function setStatus(message, type = "") {
  els.formStatus.textContent = message;
  els.formStatus.className = `form-status ${type}`.trim();
}

function parseCoordinates() {
  const matches = els.coordinatePaste.value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) return;
  setField("latitude", matches[0]);
  setField("longitude", matches[1]);
  els.coordinatePaste.value = "";
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
  els.storageBadge.textContent = health.storage === "d1" ? "Canlı DB" : "Salt okunur";

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
els.form.addEventListener("submit", saveStation);
els.coordinatePaste.addEventListener("change", parseCoordinates);

load().catch((error) => {
  els.storageBadge.textContent = "Erişim yok";
  setStatus(error.message === "admin_auth_required"
    ? "Bu panele girmek için yetkili kullanıcıyla giriş yapmak gerekiyor."
    : `Panel yüklenemedi: ${error.message}`, "error");
});
