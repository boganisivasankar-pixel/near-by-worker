const fallbackPhotos = {
  electrician: "photo-1500648767791-00dcc994a43e",
  plumber: "photo-1534528741775-53994a69daeb",
  carpenter: "photo-1506794778202-cad84cf45f1d",
  mechanic: "photo-1507003211169-0a1dd7228f2d",
  cleaner: "photo-1544005313-94ddf0286df2"
};

const state = {
  category: "",
  service: "",
  workerSearchRequestId: 0,
  latitude: null,
  longitude: null,
  radiusKm: 10,
  workers: [],
  parts: [],
  partCategories: [],
  partCategory: "",
  partSearch: "",
  estimate: new Map(),
  labourRates: [],
  selectedLabourRate: null,
  inventoryAdminRows: [],
  pendingBooking: null,
  selectedRole: "user",
  authMode: "login",
  authMethod: "password",
  otpPhone: "",
  session: JSON.parse(sessionStorage.getItem("nearbySession") || "null")
};
let bookingRefreshTimer = null;

const elements = {
  grid: document.querySelector("#workerGrid"),
  empty: document.querySelector("#emptyState"),
  count: document.querySelector("#resultCount"),
  title: document.querySelector("#resultsTitle"),
  modal: document.querySelector("#modalBackdrop"),
  modalContent: document.querySelector("#modalContent"),
  toast: document.querySelector("#toast"),
  locationMessage: document.querySelector("#locationMessage")
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatRupees(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function cookieValue(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}

function workerPhoto(category, index = 0) {
  const imageId = fallbackPhotos[category] || fallbackPhotos.electrician;
  const alternateIds = [imageId, fallbackPhotos.mechanic, fallbackPhotos.carpenter];
  const chosen = alternateIds[index % alternateIds.length];
  return `https://images.unsplash.com/${chosen}?auto=format&fit=crop&w=320&h=400&q=80`;
}

function distanceBetween(worker) {
  if (state.latitude == null || state.longitude == null) return null;
  if (worker.latitude == null || worker.longitude == null) return null;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(worker.latitude - state.latitude);
  const longitudeDelta = toRadians(worker.longitude - state.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(state.latitude)) * Math.cos(toRadians(worker.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 0.621371;
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = cookieValue("csrf_access_token");
    if (csrfToken) headers["X-CSRF-TOKEN"] = csrfToken;
  }
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || "Something went wrong. Please try again.");
  return payload;
}

function notify(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function updateAccountActions() {
  const authenticated = Boolean(state.session?.id && state.session?.role);
  document.querySelector("#authButton").hidden = authenticated;
  document.querySelector("#accountAvatar").hidden = !authenticated;
  document.querySelector("#requestsButton").hidden = !authenticated || state.session?.role === "admin";
  document.querySelector("#requestsButton").textContent = state.session?.role === "worker" ? "Service requests" : "My requests";
  document.querySelector("#accountAvatar").textContent = (state.session?.name || "N").slice(0, 1).toUpperCase();
  document.querySelector("#accountAvatar").title = `${state.session?.name || "Account"} · sign out`;
}

function renderWorkers() {
  const sortMode = document.querySelector("#sortSelect").value;
  const workers = [...state.workers];
  workers.forEach((worker) => {
    worker.distance = worker.distance_km != null
      ? Number(worker.distance_km) * 0.621371
      : distanceBetween(worker);
  });
  if (sortMode === "rating") workers.sort((a, b) => Number(b.rating) - Number(a.rating));
  else if (sortMode === "price") workers.sort((a, b) => Number(a.charge) - Number(b.charge));
  else workers.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  const categoryNames = {
    electrician: "Electrical",
    plumber: "Plumbing",
    carpenter: "Carpentry",
    mechanic: "Mechanics",
    cleaner: "Cleaning"
  };
  const categoryName = categoryNames[state.category] || "";
  const filterSummary = [
    categoryName,
    state.service ? `matching “${state.service}”` : ""
  ].filter(Boolean);
  const countContext = filterSummary.length
    ? ` · ${filterSummary.join(" · ")}${state.latitude == null ? "" : ` · within ${state.radiusKm} km`}`
    : state.latitude == null ? " · all locations" : ` · within ${state.radiusKm} km`;
  elements.count.textContent = `${workers.length} ${workers.length === 1 ? "local pro" : "local pros"}${countContext}`;
  elements.title.textContent = categoryName
    ? `${categoryName}${state.service ? ` matching “${state.service}”` : state.latitude == null ? " pros" : " pros nearby"}`
    : state.service ? `Workers matching “${state.service}”` : state.latitude == null ? "Workers" : "Workers nearby";

  const emptyTitle = elements.empty.querySelector("h3");
  const emptyMessage = elements.empty.querySelector("p");
  if (categoryName && state.service) {
    emptyTitle.textContent = `No ${categoryName} matched “${state.service}”.`;
    emptyMessage.textContent = "Try another search or choose a different category.";
  } else if (categoryName) {
    emptyTitle.textContent = `No ${categoryName} pros nearby just yet.`;
    emptyMessage.textContent = "Try another category or view everyone.";
  } else if (state.service) {
    emptyTitle.textContent = `No workers matched “${state.service}”.`;
    emptyMessage.textContent = "Try another search term or view everyone.";
  } else {
    emptyTitle.textContent = "No local pros are listed just yet.";
    emptyMessage.textContent = "Try another service or widen your search.";
  }
  elements.grid.innerHTML = workers.map((worker, index) => {
    const available = worker.available && !worker.is_sample_profile;
    const distance = worker.distance == null
      ? state.latitude == null ? "Set location for distance" : "Worker location unavailable"
      : `${worker.distance.toFixed(1)} mi away`;
    const service = worker.services || `${worker.category} services`;
    return `<article class="worker-card" style="animation-delay:${Math.min(index * 45, 250)}ms">
      <img class="worker-photo" src="${workerPhoto(worker.category, index)}" alt="Local ${escapeHtml(worker.category)} ${escapeHtml(worker.name)}" loading="lazy">
      <div class="worker-info">
        <div class="worker-meta"><span class="worker-category">${escapeHtml(worker.category)}</span><span class="availability ${available ? "" : "offline"}">${worker.is_sample_profile ? "Example profile" : available ? "Available" : "Away"}</span></div>
        <h3 class="worker-name">${escapeHtml(worker.name)}</h3>
        <p class="worker-services">${escapeHtml(service)}</p>
        <div class="worker-facts"><span><strong>★ ${Number(worker.rating || 0).toFixed(1)}</strong> (${Number(worker.reviews || 0)})</span><span>${escapeHtml(distance)}</span></div>
      </div>
      <div class="worker-price"><span class="price-label">LABOUR</span><strong class="price-value">INR quote</strong><span class="price-example">from worker profile</span><button class="profile-button" data-profile="${worker.id}">View profile</button></div>
    </article>`;
  }).join("");
  elements.empty.hidden = workers.length > 0;
}

async function loadWorkers() {
  const requestId = ++state.workerSearchRequestId;
  const category = state.category;
  const service = state.service;
  const categoryNames = {
    electrician: "Electrical",
    plumber: "Plumbing",
    carpenter: "Carpentry",
    mechanic: "Mechanics",
    cleaner: "Cleaning"
  };
  const searchContext = [
    categoryNames[category],
    service ? `matching “${service}”` : ""
  ].filter(Boolean).join(" · ");
  elements.count.textContent = searchContext ? `Searching ${searchContext}…` : "Finding local pros…";
  const query = new URLSearchParams();
  let endpoint = "/api/workers/search";
  if (state.latitude != null && state.longitude != null) {
    endpoint = "/api/workers/nearby";
    query.set("latitude", state.latitude);
    query.set("longitude", state.longitude);
    query.set("radius", state.radiusKm);
  }
  if (category) query.set("category", category);
  if (service) query.set("service", service);
  try {
    const workers = await api(`${endpoint}?${query.toString()}`);
    if (requestId !== state.workerSearchRequestId) return;
    state.workers = workers;
    renderWorkers();
  } catch (error) {
    if (requestId !== state.workerSearchRequestId) return;
    elements.count.textContent = "Workers could not be loaded";
    notify(error.message);
  }
}

function renderPartCategories() {
  const categories = ["All parts", ...state.partCategories];
  document.querySelector("#partsCategories").innerHTML = categories.map((category) => {
    const value = category === "All parts" ? "" : category;
    return `<button class="parts-category-button ${state.partCategory === value ? "active" : ""}" data-part-category="${escapeHtml(value)}">${escapeHtml(category)}</button>`;
  }).join("");
}

function renderParts() {
  const partsGrid = document.querySelector("#partsGrid");
  document.querySelector("#partsCount").textContent = `${state.parts.length} inventory ${state.parts.length === 1 ? "item" : "items"}`;
  partsGrid.innerHTML = state.parts.map((part) => `<article class="part-card">
    <div class="part-copy"><span class="part-category">${escapeHtml(part.category)}</span><h3 class="part-name">${escapeHtml(part.name)}</h3>
      <span class="part-price">${part.price_verified ? `<strong>${formatRupees(part.price_inr)}</strong> / ${escapeHtml(part.unit)}` : "Price unverified"}</span>
      <span class="part-stock">${part.stock_status === "in_stock" ? `In stock · ${Number(part.stock_quantity)}` : part.stock_status === "out_of_stock" ? "Out of stock" : "Stock unverified"} · Seller: ${escapeHtml(part.seller)}</span>
      <span class="part-updated">Updated ${escapeHtml(part.last_updated || "unknown")} · source: ${escapeHtml(part.source_reference)}</span></div>
    <button class="add-part-button" type="button" data-add-part="${part.id}" aria-label="Add ${escapeHtml(part.name)} to estimate" ${!part.price_verified || part.stock_status === "out_of_stock" ? "disabled" : ""}>Add to estimate</button>
  </article>`).join("");
  const empty = document.querySelector("#partsEmpty");
  empty.hidden = state.parts.length > 0;
  if (!state.parts.length && !state.partSearch && !state.partCategory) {
    empty.querySelector("h3").textContent = "No verified inventory entries yet.";
    empty.querySelector("p").textContent = "An administrator must add seller-confirmed prices and stock before parts appear here.";
  } else {
    empty.querySelector("h3").textContent = "No matching inventory items.";
    empty.querySelector("p").textContent = "Try another part name or category.";
  }
}

async function loadParts() {
  const query = new URLSearchParams();
  if (state.partCategory) query.set("category", state.partCategory);
  if (state.partSearch) query.set("q", state.partSearch);
  document.querySelector("#partsCount").textContent = "Searching verified inventory…";
  try {
    state.parts = await api(`/api/inventory/parts?${query.toString()}`);
    renderParts();
  } catch (error) {
    document.querySelector("#partsCount").textContent = "Verified inventory unavailable";
    notify(error.message);
  }
}

async function loadPartCategories() {
  try {
    state.partCategories = await api("/api/inventory/categories");
    renderPartCategories();
  } catch (error) {
    notify(error.message);
  }
}

async function loadEstimateWorkers() {
  try {
    const workers = await api("/api/workers/search");
    const availableWorkers = workers.filter((worker) => worker.available && !worker.is_sample_profile);
    document.querySelector("#estimateWorker").innerHTML = `<option value="">Choose an available worker</option>${availableWorkers.map((worker) => `<option value="${worker.id}">${escapeHtml(worker.name)} · ${escapeHtml(worker.category)}</option>`).join("")}`;
  } catch (error) {
    notify(error.message);
  }
}

async function loadWorkerLabourRates(workerId) {
  state.labourRates = [];
  state.selectedLabourRate = null;
  const serviceSelect = document.querySelector("#repairService");
  serviceSelect.disabled = true;
  serviceSelect.innerHTML = `<option value="">Loading worker quotes…</option>`;
  document.querySelector("#labourCharge").value = "0.00";
  if (!workerId) {
    serviceSelect.innerHTML = `<option value="">Choose a worker first</option>`;
    renderEstimate();
    return;
  }
  try {
    const rates = await api(`/api/workers/${workerId}/labour-rates`);
    state.labourRates = rates.map((rate) => ({ ...rate, amount_paise: Math.round(Number(rate.amount_inr) * 100) }));
    serviceSelect.innerHTML = `<option value="">Choose a worker-quoted service</option>${state.labourRates.map((rate) => `<option value="${rate.id}">${escapeHtml(rate.service)} · ${formatRupees(rate.amount_inr)}</option>`).join("")}`;
    serviceSelect.disabled = state.labourRates.length === 0;
    if (!state.labourRates.length) serviceSelect.innerHTML = `<option value="">This worker has no INR labour quotes yet</option>`;
  } catch (error) {
    serviceSelect.innerHTML = `<option value="">Labour quotes unavailable</option>`;
    notify(error.message);
  }
  renderEstimate();
}

function renderEstimate() {
  const selected = [...state.estimate.values()];
  const itemCount = selected.reduce((total, item) => total + item.quantity, 0);
  const partsPaise = selected.reduce((total, item) => total + item.price_paise * item.quantity, 0);
  const labourPaise = state.selectedLabourRate?.amount_paise || 0;
  const items = document.querySelector("#estimateItems");
  document.querySelector("#estimateItemCount").textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  items.innerHTML = selected.length ? selected.map((item) => `<div class="estimate-item">
    <div><span class="estimate-item-name">${escapeHtml(item.name)}</span><span class="estimate-item-price">${formatRupees(item.price_paise * item.quantity / 100)} · ${escapeHtml(item.unit)} × ${item.quantity} · ${item.stock_status === "unknown" ? "stock unverified" : "stock checked"}</span></div>
    <div class="quantity-control"><button type="button" data-quantity-action="minus" data-part-id="${item.id}" aria-label="Remove one ${escapeHtml(item.name)}">−</button><input type="number" min="1" max="${item.stock_verified ? item.stock_quantity : 999}" value="${item.quantity}" data-part-quantity="${item.id}" aria-label="Quantity of ${escapeHtml(item.name)}"><button type="button" data-quantity-action="plus" data-part-id="${item.id}" aria-label="Add one ${escapeHtml(item.name)}">+</button></div>
  </div>`).join("") : `<p class="estimate-empty">Add parts from the catalogue to begin.</p>`;
  document.querySelector("#partsSubtotal").textContent = formatRupees(partsPaise / 100);
  document.querySelector("#labourCharge").value = (labourPaise / 100).toFixed(2);
  document.querySelector("#labourTotal").textContent = formatRupees(labourPaise / 100);
  document.querySelector("#grandTotal").textContent = formatRupees((partsPaise + labourPaise) / 100);
}

function createEstimate() {
  const selected = [...state.estimate.values()];
  const partsSubtotalPaise = selected.reduce((total, item) => total + item.price_paise * item.quantity, 0);
  const labourPaise = state.selectedLabourRate?.amount_paise || 0;
  return {
    currency: "INR",
    is_sample_estimate: false,
    repair_service: state.selectedLabourRate?.service || "",
    labour_rate_id: state.selectedLabourRate?.id || null,
    parts: selected.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity
    })),
    parts_subtotal_paise: partsSubtotalPaise,
    labour_amount_paise: labourPaise,
    total_paise: partsSubtotalPaise + labourPaise
  };
}

function openModal(content) {
  window.clearInterval(bookingRefreshTimer);
  elements.modalContent.innerHTML = content;
  elements.modal.hidden = false;
  document.body.style.overflow = "hidden";
  elements.modal.querySelector("input, button, select, textarea")?.focus();
}

function closeModal() {
  window.clearInterval(bookingRefreshTimer);
  bookingRefreshTimer = null;
  elements.modal.hidden = true;
  document.body.style.overflow = "";
}

function authForm() {
  const register = state.authMode === "register";
  const worker = state.selectedRole === "worker";
  const admin = state.selectedRole === "admin";
  if (admin && register) state.authMode = "login";
  const otpPhone = !register && !admin && state.authMethod === "otp-phone";
  const otpCode = !register && !admin && state.authMethod === "otp-code";
  const title = register ? (worker ? "Join your local network" : "A little about you") : admin ? "Inventory administrator" : "Welcome back";
  const fields = register ? `<label>Your name<input name="name" required maxlength="100" autocomplete="name" placeholder="Your full name"></label>
    <label>Phone number<input name="phone" required maxlength="20" autocomplete="tel" placeholder="(555) 555-0100"></label>
    <label>Password<input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></label>
    ${worker ? `<label>Your service<select name="category" required><option value="">Choose a trade</option><option value="electrician">Electrician</option><option value="plumber">Plumber</option><option value="carpenter">Carpenter</option><option value="mechanic">Mechanic</option><option value="cleaner">Cleaner</option><option value="other">Other local service</option></select></label>
      <label>Services you offer<input name="services" maxlength="500" placeholder="Repairs, installs, diagnostics…"></label>
      <label>Example call-out price (USD)<input name="charge" type="number" min="0" step="1" value="55" required></label>
      <label>Parts and example prices<textarea name="spare_parts" maxlength="500" placeholder="Common parts and example prices"></textarea></label>` : ""}` : `
    ${admin ? `<label>Admin username<input name="username" required autocomplete="username"></label><label>Admin password<input name="password" type="password" required autocomplete="current-password"></label>` : otpCode ? `<label>Phone number<input name="phone" required value="${escapeHtml(state.otpPhone)}" readonly></label><label>SMS verification code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" required></label>` : `<label>Phone number<input name="phone" required maxlength="20" autocomplete="tel" placeholder="+14155552671"></label>${otpPhone ? "" : `<label>Password<input name="password" type="password" required autocomplete="current-password" placeholder="Your password"></label>`}`}`;
  openModal(`<p class="modal-eyebrow">NEARBY WORKER ACCOUNT</p><h2 id="modalTitle">${title}</h2>
    <div class="role-tabs"><button class="role-tab ${state.selectedRole === "user" ? "active" : ""}" data-role="user">Customer</button><button class="role-tab ${worker ? "active" : ""}" data-role="worker">Worker</button><button class="role-tab ${admin ? "active" : ""}" data-role="admin">Admin</button></div>
    <form class="form-stack" id="authForm">${fields}<button class="form-submit" type="submit">${register ? "Create account" : otpPhone ? "Send SMS code" : otpCode ? "Verify code and sign in" : "Sign in"}</button></form>
    ${admin ? `<p class="form-note">Administrator access must be configured privately on the server.</p>` : `<p class="mode-switch">${register ? "Already have an account?" : "New to the neighborhood?"} <button type="button" id="switchAuthMode">${register ? "Sign in" : "Create an account"}</button></p>${!register ? `<p class="mode-switch"><button type="button" id="switchAuthMethod">${otpPhone || otpCode ? "Use password instead" : "Sign in with SMS code"}</button></p>` : ""}`}
    <p class="form-note">Prototype only. Sample profiles and rates are examples, not quotes.</p>`);
  elements.modalContent.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", () => {
    state.selectedRole = button.dataset.role;
    state.authMethod = "password";
    if (state.selectedRole === "admin") state.authMode = "login";
    authForm();
  }));
  elements.modalContent.querySelector("#switchAuthMode")?.addEventListener("click", () => {
    state.authMode = register ? "login" : "register";
    state.authMethod = "password";
    authForm();
  });
  elements.modalContent.querySelector("#switchAuthMethod")?.addEventListener("click", () => {
    state.authMethod = otpPhone || otpCode ? "password" : "otp-phone";
    authForm();
  });
  elements.modalContent.querySelector("#authForm").addEventListener("submit", submitAuth);
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form.entries());
  const isRegister = state.authMode === "register";
  const role = state.selectedRole;
  try {
    if (isRegister) {
      if (role === "admin") throw new Error("Administrator accounts are configured by the site owner.");
      data.latitude = state.latitude;
      data.longitude = state.longitude;
      const prefix = role === "worker" ? "/api/workers" : "/api/users";
      await api(`${prefix}/register`, { method: "POST", body: JSON.stringify(data) });
      notify("Account created. Sign in to continue.");
      state.authMode = "login";
      state.authMethod = "password";
      authForm();
      return;
    }

    let result;
    if (role !== "admin" && state.authMethod === "otp-phone") {
      result = await api("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone: data.phone, role })
      });
      state.otpPhone = data.phone;
      state.authMethod = "otp-code";
      authForm();
      notify(result.message);
      return;
    }
    if (role !== "admin" && state.authMethod === "otp-code") {
      result = await api("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ phone: state.otpPhone, code: data.code, role })
      });
    } else {
      const loginPath = role === "admin" ? "/api/admin/login" : `${role === "worker" ? "/api/workers" : "/api/users"}/login`;
      result = await api(loginPath, { method: "POST", body: JSON.stringify(data) });
    }

    const id = role === "admin" ? result.admin_id : role === "worker" ? result.worker_id : result.user_id;
    state.session = { id, role, name: role === "admin" ? "Inventory administrator" : data.name || data.phone || state.otpPhone };
    if (role === "worker") {
      const profile = await api(`/api/workers/${id}`);
      state.session.name = profile.name;
      state.session.available = profile.available;
    }
    sessionStorage.setItem("nearbySession", JSON.stringify(state.session));
    updateAccountActions();
    if (role === "admin") document.querySelector("#workerJoinButton").textContent = "Manage inventory";
    if (role === "worker") document.querySelector("#workerJoinButton").textContent = "Worker dashboard";
    closeModal();
    notify(`Signed in as ${role === "admin" ? "inventory administrator" : role === "worker" ? "a worker" : "a customer"}.`);
    if (state.pendingBooking && role === "user") {
      const pendingBooking = state.pendingBooking;
      state.pendingBooking = null;
      const worker = await api(`/api/workers/${pendingBooking.workerId}`);
      openBookingForm(worker, pendingBooking.estimate);
    }
  } catch (error) {
    notify(error.message);
  }
}

async function showProfile(id) {
  try {
    const [worker, reviews] = await Promise.all([
      api(`/api/workers/${id}`), api(`/api/workers/${id}/reviews`)
    ]);
    const distance = distanceBetween(worker);
    const parts = worker.spare_parts || "Ask the worker about parts for this job.";
    const labourRates = worker.labour_rates || [];
    const labourMarkup = labourRates.length
      ? labourRates.map((rate) => `<p>${escapeHtml(rate.service)} · <strong>${formatRupees(rate.amount_inr)}</strong> · worker quote</p>`).join("")
      : `<p>This worker has not published an INR labour quote yet.</p>`;
    const reviewMarkup = reviews.length
      ? reviews.slice(0, 3).map((review) => `<div class="review-item"><strong>★ ${Number(review.rating).toFixed(1)}</strong><p>${escapeHtml(review.review || "A helpful local pro.")}</p></div>`).join("")
      : `<p>No reviews yet. Book a service to leave the first one.</p>`;
    openModal(`<div class="profile-top"><img class="profile-photo" src="${workerPhoto(worker.category, id)}" alt="${escapeHtml(worker.name)}">
      <div><span class="worker-category">${escapeHtml(worker.category)}</span><h2 id="modalTitle">${escapeHtml(worker.name)}</h2><span class="availability ${worker.available ? "" : "offline"}">${worker.available ? "Available for requests" : "Not taking requests"}</span></div></div>
      <div class="profile-facts"><div class="profile-fact"><span>RATING</span><strong>★ ${Number(worker.rating).toFixed(1)} (${Number(worker.reviews)})</strong></div><div class="profile-fact"><span>INR LABOUR QUOTES</span><strong>${labourRates.length ? labourRates.length : "Not listed"}</strong></div><div class="profile-fact"><span>FROM YOU</span><strong>${distance == null ? "Set location" : `${distance.toFixed(1)} mi`}</strong></div></div>
      <div class="profile-detail"><h3>SERVICES</h3><p>${escapeHtml(worker.services || "Local repair and maintenance")}</p></div>
      <div class="profile-detail"><h3>WORKER LABOUR QUOTES · INR</h3>${labourMarkup}</div>
      <div class="profile-detail"><h3>PARTS</h3><p>${escapeHtml(parts)}</p></div>
      <div class="profile-detail"><h3>CONTACT</h3><p class="contact-line"><a href="tel:${escapeHtml(worker.phone)}">${escapeHtml(worker.phone)}</a></p></div>
      <div class="profile-detail"><h3>NEIGHBOR NOTES</h3>${reviewMarkup}</div>
      ${state.session?.role === "worker" && state.session.id === worker.id ? `<button class="form-submit" id="availabilityToggle">Set as ${worker.available ? "unavailable" : "available"}</button>` : worker.is_sample_profile ? `<button class="form-submit" disabled>Example profile · not bookable</button>` : !worker.labour_rates?.length ? `<button class="form-submit" disabled>No worker INR labour quote yet</button>` : `<button class="form-submit" id="bookWorker" ${worker.available ? "" : "disabled"}>Request this service</button>`}
      <p class="form-note">Part prices and stock appear only when administrator-verified. Confirm labour and stock with the worker before work begins.</p>`);
    const bookButton = elements.modalContent.querySelector("#bookWorker");
    if (bookButton) bookButton.addEventListener("click", () => openBookingForm(worker));
    const availabilityButton = elements.modalContent.querySelector("#availabilityToggle");
    if (availabilityButton) availabilityButton.addEventListener("click", () => toggleAvailability(worker));
  } catch (error) {
    notify(error.message);
  }
}

async function showAdminInventory(editPart = null) {
  if (state.session?.role !== "admin") {
    notify("Inventory administration requires an administrator account.");
    return;
  }
  try {
    state.inventoryAdminRows = await api("/api/admin/inventory");
  } catch (error) {
    openModal(`<p class="modal-eyebrow">INVENTORY SETUP</p><h2 id="modalTitle">Catalog management unavailable</h2><p>${escapeHtml(error.message)}</p><p class="form-note">The additive inventory migration must be reviewed and applied, and the admin environment settings must be configured. No sample market prices or stock are substituted.</p>`);
    return;
  }

  const rows = state.inventoryAdminRows.map((part) => `<div class="booking-item inventory-admin-row">
    <strong>${escapeHtml(part.name)} · ${escapeHtml(part.category)}</strong>
    <span>${part.price_verified ? `${formatRupees(part.price_inr)} / ${escapeHtml(part.unit)}` : "Price unverified"} · ${part.stock_status === "unknown" ? "Stock unverified" : `${part.stock_status.replaceAll("_", " ")} (${part.stock_quantity})`} · ${escapeHtml(part.seller)}</span>
    <button class="profile-button" type="button" data-edit-inventory="${part.id}">Edit</button>
  </div>`).join("") || `<p class="form-note">No inventory has been entered. Add only seller-confirmed information.</p>`;
  openModal(`<p class="modal-eyebrow">ADMIN · VERIFIED SELLER DATA</p><h2 id="modalTitle">Repair parts inventory</h2>
    <div class="inventory-admin-list" id="inventoryAdminList">${rows}</div>
    <form class="form-stack inventory-admin-form" id="inventoryAdminForm">
      <h3 id="inventoryFormTitle">Add inventory item</h3>
      <label>Part name<input name="name" maxlength="120" required></label>
      <div class="form-row"><label>Category<input name="category" maxlength="80" required></label><label>Unit<input name="unit" maxlength="30" placeholder="piece, metre, set" required></label></div>
      <label>Seller<input name="seller" maxlength="120" required></label>
      <label>Price source/reference<input name="source_reference" maxlength="300" placeholder="Supplier quote/reference and checked date" required></label>
      <label>Current price (INR)<input name="price_inr" type="number" min="0" step="0.01" inputmode="decimal"></label>
      <label class="check-label"><input name="price_verified" type="checkbox"> I verified this price against the source above</label>
      <label>Current stock quantity<input name="stock_quantity" type="number" min="0" step="1" inputmode="numeric"></label>
      <label class="check-label"><input name="stock_verified" type="checkbox"> I checked this stock with the seller</label>
      <label class="check-label"><input name="active" type="checkbox" checked> Show in customer catalogue</label>
      <button class="form-submit" type="submit">Save verified inventory data</button>
      <button class="profile-button" type="button" id="resetInventoryForm">Clear form</button>
    </form>
    <p class="form-note">Only mark data verified after checking the named seller/source. Stock is informational and is rechecked with the seller during booking.</p>`);

  const form = document.querySelector("#inventoryAdminForm");
  const editButtons = elements.modalContent.querySelectorAll("[data-edit-inventory]");
  editButtons.forEach((button) => button.addEventListener("click", () => {
    const part = state.inventoryAdminRows.find((row) => row.id === Number(button.dataset.editInventory));
    if (!part) return;
    form.dataset.inventoryId = String(part.id);
    document.querySelector("#inventoryFormTitle").textContent = `Edit ${part.name}`;
    for (const field of ["name", "category", "unit", "seller", "source_reference"]) form.elements[field].value = part[field] || "";
    form.elements.price_inr.value = part.price_inr ?? "";
    form.elements.price_verified.checked = Boolean(part.price_verified);
    form.elements.stock_quantity.value = part.stock_quantity ?? "";
    form.elements.stock_verified.checked = Boolean(part.stock_verified);
    form.elements.active.checked = Boolean(part.active);
  }));
  document.querySelector("#resetInventoryForm").addEventListener("click", () => {
    form.reset();
    delete form.dataset.inventoryId;
    document.querySelector("#inventoryFormTitle").textContent = "Add inventory item";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    data.price_verified = form.elements.price_verified.checked;
    data.stock_verified = form.elements.stock_verified.checked;
    data.active = form.elements.active.checked;
    data.price_inr = data.price_inr === "" ? null : Number(data.price_inr);
    data.stock_quantity = data.stock_quantity === "" ? null : Number(data.stock_quantity);
    const id = form.dataset.inventoryId;
    try {
      await api(id ? `/api/admin/inventory/${id}` : "/api/admin/inventory", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(data)
      });
      notify("Inventory record saved.");
      await showAdminInventory();
    } catch (error) {
      notify(error.message);
    }
  });
}

async function showWorkerDashboard() {
  if (state.session?.role !== "worker") {
    notify("Sign in with a worker account to manage a profile.");
    return;
  }

  try {
    const worker = await api(`/api/workers/${state.session.id}`);
    const [coverageResult, labourResult] = await Promise.allSettled([
      api(`/api/workers/${state.session.id}/coverage`),
      api(`/api/workers/${state.session.id}/labour-rates`)
    ]);
    const coverage = coverageResult.status === "fulfilled" ? coverageResult.value : null;
    const labourRates = labourResult.status === "fulfilled" ? labourResult.value : [];
    openModal(`<p class="modal-eyebrow">WORKER DASHBOARD</p><h2 id="modalTitle">Manage your profile</h2>
      <form class="form-stack" id="workerProfileForm">
        <label>Name<input name="name" maxlength="100" required value="${escapeHtml(worker.name)}"></label>
        <label>Contact phone<input name="phone" maxlength="20" required value="${escapeHtml(worker.phone)}"></label>
        <label>Service category<input name="category" maxlength="50" list="workerCategoryOptions" required value="${escapeHtml(worker.category)}"><datalist id="workerCategoryOptions"><option value="electrician"><option value="plumber"><option value="carpenter"><option value="mechanic"><option value="cleaner"><option value="other"></datalist></label>
        <label>Services offered<input name="services" maxlength="500" value="${escapeHtml(worker.services || "")}"></label>
        <label>Example call-out charge (USD)<input name="charge" type="number" min="0" step="1" required value="${Number(worker.charge || 0)}"></label>
        <label>Parts and example prices<textarea name="spare_parts" maxlength="500">${escapeHtml(worker.spare_parts || "")}</textarea></label>
        <div class="form-row"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" value="${worker.latitude ?? ""}"></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" value="${worker.longitude ?? ""}"></label></div>
        <button class="profile-button" type="button" id="workerGpsButton">Update coordinates from device</button>
        <button class="form-submit" type="submit">Save profile</button>
      </form>
      <div class="profile-detail"><h3>AVAILABILITY</h3><p>${worker.available ? "Available for requests" : "Not taking requests"}</p><button class="profile-button" id="workerAvailabilityButton">Set as ${worker.available ? "unavailable" : "available"}</button></div>
      <div class="profile-detail"><h3>SERVICE AREA</h3>
        <form class="form-stack" id="workerCoverageForm"><label>Area label<input name="service_area" maxlength="160" required value="${escapeHtml(coverage?.service_area || "")}" placeholder="Neighborhoods or towns you serve"></label><label>Maximum travel radius (km)<input name="radius_km" type="number" min="1" max="500" required value="${coverage?.radius_km ?? 10}"></label><button class="profile-button" type="submit">Save service area</button></form>
        ${coverageResult.status === "rejected" ? `<p class="form-note">Coverage setup is unavailable until the database migration is applied.</p>` : ""}
      </div>
      <div class="profile-detail"><h3>YOUR INR LABOUR QUOTES</h3>
        <div class="booking-list">${labourRates.map((rate) => `<div class="booking-item"><strong>${escapeHtml(rate.service)}</strong><span>Worker quote · ${formatRupees(rate.amount_inr)} · updated ${escapeHtml(rate.updated_at)}</span></div>`).join("") || `<p class="form-note">No labour quotes yet.</p>`}</div>
        <form class="form-stack" id="workerLabourForm"><label>Repair service<input name="service" maxlength="120" required placeholder="e.g. Tap repair"></label><label>Labour charge (INR)<input name="amount_inr" type="number" min="0" step="0.01" required inputmode="decimal"></label><button class="profile-button" type="submit">Save labour quote</button></form>
        ${labourResult.status === "rejected" ? `<p class="form-note">Labour quotes are unavailable until the database migration is applied.</p>` : ""}
      </div>
      <p class="form-note">Nearby results require saved coordinates and a declared service radius. Customers’ radius cannot expand your service area.</p>`);

    document.querySelector("#workerGpsButton").addEventListener("click", () => {
      if (!navigator.geolocation) {
        notify("Location is not available in this browser.");
        return;
      }
      navigator.geolocation.getCurrentPosition((position) => {
        document.querySelector("#workerProfileForm [name=latitude]").value = position.coords.latitude;
        document.querySelector("#workerProfileForm [name=longitude]").value = position.coords.longitude;
        notify("Coordinates filled. Save the profile to update your location.");
      }, () => notify("Location permission was not granted."), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
    });

    document.querySelector("#workerProfileForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      data.latitude = data.latitude === "" ? null : Number(data.latitude);
      data.longitude = data.longitude === "" ? null : Number(data.longitude);
      data.charge = Number(data.charge);
      try {
        const updated = await api(`/api/workers/${state.session.id}`, { method: "PUT", body: JSON.stringify(data) });
        state.session.name = updated.name;
        sessionStorage.setItem("nearbySession", JSON.stringify(state.session));
        updateAccountActions();
        notify("Worker profile saved.");
        await loadWorkers();
        await loadEstimateWorkers();
      } catch (error) {
        notify(error.message);
      }
    });

    document.querySelector("#workerCoverageForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      data.radius_km = Number(data.radius_km);
      try {
        await api(`/api/workers/${worker.id}/coverage`, { method: "PUT", body: JSON.stringify(data) });
        notify("Service area saved.");
        await loadWorkers();
      } catch (error) {
        notify(error.message);
      }
    });

    document.querySelector("#workerLabourForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      data.amount_inr = Number(data.amount_inr);
      try {
        await api(`/api/workers/${worker.id}/labour-rates`, { method: "POST", body: JSON.stringify(data) });
        notify("INR labour quote saved.");
        await loadEstimateWorkers();
        await showWorkerDashboard();
      } catch (error) {
        notify(error.message);
      }
    });

    document.querySelector("#workerAvailabilityButton").addEventListener("click", async () => {
      try {
        await api(`/api/workers/${worker.id}/availability`, {
          method: "PUT", body: JSON.stringify({ available: !worker.available })
        });
        closeModal();
        notify(`You are now ${worker.available ? "unavailable" : "available"}.`);
        await loadWorkers();
        await loadEstimateWorkers();
      } catch (error) {
        notify(error.message);
      }
    });
  } catch (error) {
    notify(error.message);
  }
}

function openBookingForm(worker, estimate = null) {
  if (!state.session?.id) {
    state.pendingBooking = { workerId: worker.id, estimate };
    state.selectedRole = "user";
    state.authMode = "login";
    authForm();
    notify("Sign in as a customer to send a request.");
    return;
  }
  if (state.session.role !== "user") {
    notify("Sign in as a customer to send a service request.");
    return;
  }
  const labourRates = worker.labour_rates || [];
  const estimateSummary = estimate ? `<div class="booking-estimate-summary"><strong>Itemized INR quote: ${formatRupees(estimate.total_paise / 100)}</strong><br>Parts: ${estimate.parts.length ? estimate.parts.map((part) => `${escapeHtml(part.name || "Part")} × ${part.quantity}`).join(", ") : "No parts selected"}<br>Labour: ${escapeHtml(estimate.repair_service)} · worker quote<br>Current stock is not reserved; reconfirm before work starts.</div>` : "";
  const labourRateField = !estimate ? `<label>Worker labour quote<select name="labour_rate_id" required>${labourRates.map((rate) => `<option value="${rate.id}">${escapeHtml(rate.service)} · ${formatRupees(rate.amount_inr)}</option>`).join("")}</select></label>` : "";
  openModal(`<p class="modal-eyebrow">SERVICE REQUEST</p><h2 id="modalTitle">Request ${escapeHtml(worker.category)} help</h2>
    <p class="form-note">To ${escapeHtml(worker.name)}. Confirm labour, stock and final total with the worker before work begins.</p>
    ${estimateSummary}
    <form class="form-stack" id="bookingForm"><label>What needs fixing?<input name="service" required maxlength="200" value="${escapeHtml(estimate?.repair_service || "")}" placeholder="A short description of the job"></label>${labourRateField}
    <label>Service address<textarea name="address" maxlength="300" required placeholder="Street, unit, neighborhood"></textarea></label>
    <button class="form-submit" type="submit">Send service request</button></form>`);
  elements.modalContent.querySelector("#bookingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    data.worker_id = worker.id;
    if (estimate) {
      data.estimate = estimate;
    } else {
      data.estimate = {
        currency: "INR",
        is_sample_estimate: false,
        repair_service: data.service,
        labour_rate_id: Number(data.labour_rate_id),
        parts: []
      };
      delete data.labour_rate_id;
      data.charge = 0;
    }
    try {
      const booking = await api("/api/bookings", { method: "POST", body: JSON.stringify(data) });
      closeModal();
      notify(`Request #${booking.booking_id} sent with the selected worker quote.`);
    } catch (error) {
      notify(error.message);
    }
  });
}

async function toggleAvailability(worker) {
  try {
    const result = await api(`/api/workers/${worker.id}/availability`, {
      method: "PUT", body: JSON.stringify({ available: !worker.available })
    });
    notify(`You are now ${result.available ? "available" : "unavailable"}.`);
    closeModal();
    await loadWorkers();
  } catch (error) {
    notify(error.message);
  }
}

async function showBookings() {
  if (!state.session) return;
  window.clearInterval(bookingRefreshTimer);
  const endpoint = state.session.role === "worker" ? "/api/worker/bookings" : "/api/bookings";
  const renderBookingItems = (bookings) => bookings.map((booking) => {
    let estimateMarkup = "";
    let estimate = booking.estimate;
    if (!estimate) {
      try { estimate = JSON.parse(booking.spare_parts); }
      catch { estimate = null; }
    }
    if (estimate?.currency === "INR" && Number.isInteger(estimate.total_paise)) {
      estimateMarkup = `<p class="booking-estimate-summary">Itemized INR quote: <strong>${formatRupees(estimate.total_paise / 100)}</strong><br>${estimate.parts.map((part) => `${escapeHtml(part.name)} × ${part.quantity} · ${formatRupees(part.line_total_paise / 100)}`).join(", ") || "No parts"}<br>Worker labour: ${formatRupees(estimate.labour_amount_paise / 100)}<br>${escapeHtml(estimate.stock_note || "Reconfirm stock before work.")}</p>`;
    } else if (estimate?.currency === "INR" && Number.isFinite(estimate.total_min)) {
      estimateMarkup = `<p class="booking-estimate-summary">Legacy sample estimate: ${formatRupees(estimate.total_min)} – ${formatRupees(estimate.total_max)} · not a verified quote</p>`;
    }
    const status = String(booking.status || "pending").replaceAll("_", " ");
    let actions = "";
    if (state.session.role === "worker" && booking.status === "pending") {
      actions = `<button class="profile-button" data-booking="${booking.id}" data-status="accepted">Accept</button> <button class="profile-button" data-booking="${booking.id}" data-status="rejected">Decline</button>`;
    } else if (state.session.role === "worker" && booking.status === "accepted") {
      actions = `<button class="profile-button" data-booking="${booking.id}" data-status="in_progress">Start work</button>`;
    } else if (state.session.role === "worker" && booking.status === "in_progress") {
      actions = `<button class="profile-button" data-booking="${booking.id}" data-status="completed">Mark completed</button>`;
    } else if (state.session.role === "user" && booking.status === "pending") {
      actions = `<button class="profile-button" data-booking="${booking.id}" data-status="cancelled">Cancel request</button>`;
    }
    const chargeText = estimate ? "" : ` · Legacy call-out amount (unverified) ${formatMoney(booking.charge)}`;
    return `<div class="booking-item"><strong>${escapeHtml(booking.service)}</strong><span>${state.session.role === "worker" ? `Customer #${booking.user_id} · ` : `Worker #${booking.worker_id} · `}${escapeHtml(status)}${chargeText}${booking.address ? ` · ${escapeHtml(booking.address)}` : ""}</span>${estimateMarkup}${actions ? `<div class="booking-actions">${actions}</div>` : ""}</div>`;
  }).join("");

  const refreshBookings = async (firstLoad = false) => {
    try {
    const bookings = await api(endpoint);
      const items = renderBookingItems(bookings) || "<p class='form-note'>No requests yet.</p>";
      if (firstLoad) {
        openModal(`<p class="modal-eyebrow">YOUR NEIGHBORHOOD</p><h2 id="modalTitle">${state.session.role === "worker" ? "Service requests" : "Your requests"}</h2><p class="booking-refresh" id="bookingRefreshTime"></p><div class="booking-list" id="bookingList">${items}</div>`);
      } else if (!elements.modal.hidden && document.querySelector("#bookingList")) {
        document.querySelector("#bookingList").innerHTML = items;
      }
      const refreshed = document.querySelector("#bookingRefreshTime");
      if (refreshed) refreshed.textContent = `Last refreshed ${new Date().toLocaleTimeString()}. Updates are checked every 10 seconds while this view is open.`;
    } catch (error) {
      if (firstLoad) notify(error.message);
    }
  };

  await refreshBookings(true);
  bookingRefreshTimer = window.setInterval(() => {
    if (elements.modal.hidden) {
      window.clearInterval(bookingRefreshTimer);
      bookingRefreshTimer = null;
      return;
    }
    refreshBookings();
  }, 10000);
}

elements.modalContent.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-booking]");
  if (!button) return;
  try {
    await api(`/api/bookings/${button.dataset.booking}`, {
      method: "PUT",
      body: JSON.stringify({ status: button.dataset.status })
    });
    notify(`Request ${button.dataset.status.replaceAll("_", " ")}.`);
    await showBookings();
  } catch (error) {
    notify(error.message);
  }
});

function applyCategory(category) {
  state.category = category;
  state.service = document.querySelector("#serviceSearch").value.trim();
  document.querySelectorAll(".category-chip").forEach((button) => button.classList.toggle("active", button.dataset.category === category));
  loadWorkers();
}

document.querySelector("#categoryList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (button) applyCategory(button.dataset.category);
});
document.querySelector("#searchButton").addEventListener("click", () => {
  window.clearTimeout(loadWorkers.timer);
  state.service = document.querySelector("#serviceSearch").value.trim();
  loadWorkers();
});
document.querySelector("#serviceSearch").addEventListener("input", (event) => {
  state.service = event.target.value.trim();
  window.clearTimeout(loadWorkers.timer);
  loadWorkers.timer = window.setTimeout(loadWorkers, 250);
});
document.querySelector("#serviceSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    window.clearTimeout(loadWorkers.timer);
    document.querySelector("#searchButton").click();
  }
});
document.querySelector("#clearFilter").addEventListener("click", () => {
  state.service = "";
  document.querySelector("#serviceSearch").value = "";
  applyCategory("");
});
document.querySelector("#sortSelect").addEventListener("change", renderWorkers);
elements.grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-profile]");
  if (button) showProfile(button.dataset.profile);
});
document.querySelector("#authButton").addEventListener("click", () => {
  state.selectedRole = "user";
  state.authMode = "login";
  authForm();
});
document.querySelector("#workerJoinButton").addEventListener("click", () => {
  if (state.session?.role === "admin") {
    showAdminInventory();
  } else if (state.session?.role === "worker") {
    showWorkerDashboard();
  } else {
    state.selectedRole = "worker";
    state.authMode = "register";
    authForm();
  }
});
document.querySelector("#accountAvatar").addEventListener("click", () => {
  api("/api/auth/logout", { method: "POST" }).catch(() => {}).finally(() => {
    state.session = null;
    sessionStorage.removeItem("nearbySession");
    updateAccountActions();
    notify("You are signed out.");
  });
});
document.querySelector("#requestsButton").addEventListener("click", showBookings);
document.querySelector("#modalClose").addEventListener("click", closeModal);
elements.modal.addEventListener("click", (event) => { if (event.target === elements.modal) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.modal.hidden) closeModal(); });
document.querySelector("#locateButton").addEventListener("click", () => {
  if (!navigator.geolocation) {
    elements.locationMessage.textContent = "Location is unavailable in this browser. Enter coordinates manually to see distance-filtered workers.";
    return;
  }
  elements.locationMessage.textContent = "Waiting for your location permission…";
  navigator.geolocation.getCurrentPosition((position) => {
    state.latitude = position.coords.latitude;
    state.longitude = position.coords.longitude;
    document.querySelector("#locationLabel").value = "Your current location";
    document.querySelector("#manualLatitude").value = state.latitude;
    document.querySelector("#manualLongitude").value = state.longitude;
    elements.locationMessage.textContent = "Showing available workers with verified coordinates near your device.";
    loadWorkers();
  }, () => {
    elements.locationMessage.textContent = "Location permission was not granted. Enter coordinates manually, or browse workers without distance filtering.";
  }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
});
document.querySelector("#radiusFilter").addEventListener("change", (event) => {
  state.radiusKm = Number(event.target.value);
  if (state.latitude != null && state.longitude != null) loadWorkers();
});
document.querySelector("#applyManualLocation").addEventListener("click", () => {
  const latitude = Number(document.querySelector("#manualLatitude").value);
  const longitude = Number(document.querySelector("#manualLongitude").value);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    notify("Enter a valid latitude and longitude.");
    return;
  }
  state.latitude = latitude;
  state.longitude = longitude;
  document.querySelector("#locationLabel").value = "Manual coordinates";
  elements.locationMessage.textContent = "Showing available workers with verified coordinates near this location.";
  loadWorkers();
});
document.querySelector("#partsCategories").addEventListener("click", (event) => {
  const button = event.target.closest("[data-part-category]");
  if (!button) return;
  state.partCategory = button.dataset.partCategory;
  renderPartCategories();
  loadParts();
});
document.querySelector("#partsSearch").addEventListener("input", (event) => {
  state.partSearch = event.target.value.trim();
  window.clearTimeout(loadParts.timer);
  loadParts.timer = window.setTimeout(loadParts, 180);
});
document.querySelector("#partsSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    window.clearTimeout(loadParts.timer);
    loadParts();
  }
});
document.querySelector("#partsGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-part]");
  if (!button) return;
  const part = state.parts.find((candidate) => candidate.id === Number(button.dataset.addPart));
  if (!part) return;
  if (!part.price_verified || part.stock_status === "out_of_stock") return;
  const current = state.estimate.get(part.id);
  const nextQuantity = (current?.quantity || 0) + 1;
  if (part.stock_verified && nextQuantity > part.stock_quantity) {
    notify(`Only ${part.stock_quantity} verified units are currently listed.`);
    return;
  }
  state.estimate.set(part.id, { ...part, quantity: Math.min(nextQuantity, 999) });
  renderEstimate();
  notify(`${part.name} added to the estimate.`);
});
document.querySelector("#estimateItems").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity-action]");
  if (!button) return;
  const id = Number(button.dataset.partId);
  const item = state.estimate.get(id);
  if (!item) return;
  if (button.dataset.quantityAction === "minus" && item.quantity <= 1) state.estimate.delete(id);
  else {
    const nextQuantity = item.quantity + (button.dataset.quantityAction === "plus" ? 1 : -1);
    if (button.dataset.quantityAction === "plus" && item.stock_verified && nextQuantity > item.stock_quantity) {
      notify(`Only ${item.stock_quantity} verified units are currently listed.`);
      return;
    }
    item.quantity = Math.max(1, Math.min(999, nextQuantity));
  }
  renderEstimate();
});
document.querySelector("#estimateItems").addEventListener("change", (event) => {
  const input = event.target.closest("[data-part-quantity]");
  if (!input) return;
  const item = state.estimate.get(Number(input.dataset.partQuantity));
  if (!item) return;
  const requested = Math.max(1, Math.min(999, Number.parseInt(input.value, 10) || 1));
  if (item.stock_verified && requested > item.stock_quantity) {
    item.quantity = item.stock_quantity;
    notify(`Quantity was limited to ${item.stock_quantity} verified units.`);
  } else {
    item.quantity = requested;
  }
  renderEstimate();
});
document.querySelector("#clearEstimate").addEventListener("click", () => {
  state.estimate.clear();
  renderEstimate();
});
document.querySelector("#estimateWorker").addEventListener("change", (event) => {
  loadWorkerLabourRates(event.target.value);
});
document.querySelector("#repairService").addEventListener("change", (event) => {
  state.selectedLabourRate = state.labourRates.find((rate) => rate.id === Number(event.target.value)) || null;
  renderEstimate();
});
document.querySelector("#useEstimate").addEventListener("click", async () => {
  const workerId = document.querySelector("#estimateWorker").value;
  if (!workerId) {
    notify("Choose an available worker to include this estimate in a booking.");
    return;
  }
  if (!state.selectedLabourRate) {
    notify("Select a current INR labour quote from the chosen worker.");
    return;
  }
  try {
    const worker = await api(`/api/workers/${workerId}`);
    openBookingForm(worker, createEstimate());
  } catch (error) {
    notify(error.message);
  }
});

async function initializePage() {
  if (state.session?.id) {
    try {
      state.session = await api("/api/auth/me");
      sessionStorage.setItem("nearbySession", JSON.stringify(state.session));
    } catch {
      state.session = null;
      sessionStorage.removeItem("nearbySession");
    }
  }
  updateAccountActions();
  if (state.session?.role === "worker") document.querySelector("#workerJoinButton").textContent = "Worker dashboard";
  if (state.session?.role === "admin") document.querySelector("#workerJoinButton").textContent = "Manage inventory";
  await Promise.all([loadWorkers(), loadPartCategories(), loadParts(), loadEstimateWorkers()]);
  renderEstimate();
  if (!state.session?.id) {
    state.selectedRole = "user";
    state.authMode = "login";
    authForm();
  }
}

initializePage();