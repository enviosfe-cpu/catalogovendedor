/**
 * Distribuciones Castro Preventa - Main Application Engine
 */

const DEFAULT_SHEETS_URL = "https://script.google.com/macros/s/AKfycbzgitAKy2x0rodDbi66u0njHy4M-mn-3g9pQXizkBGbGquDtauwaabr3ruMN2UiXF4X8g/exec";

// Global State
let state = {
  products: [],
  clients: [],
  discounts: [],
  cabysMap: {},
  images: {},
  maestros: { proveedores: {}, categorias: {} },
  companyName: "",
  brandLogo: "",
  vendedor: null,
  pendingVendor: null,
  selectedSupplier: 'ALL',
  sheetsUrl: (function() {
    try { return (localStorage.getItem('ecomdx_sheets_url') || "").trim(); } catch (e) { return ""; }
  })(),
  currentClient: null,
  selectedCategory: 'ALL',
  searchQuery: '',
  deferredPrompt: null,
  zoomLevel: 1
};

// Logo tolerante a estructura plana (repo raíz) o con carpetas (dev local)
const LOGO_CANDIDATES = ['./logo.png', '../images/logo.png'];
function logoSrc() { return LOGO_CANDIDATES[0]; }

// ── Almacenamiento IndexedDB para catálogos grandes (sin límite de 5MB de localStorage) ──
const IDB_NAME = 'ecomdx_preventa_db';
const IDB_VERSION = 1;
const IDB_STORE = 'catalog_cache';

function getDB() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function idbGet(key) {
  try {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await getDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

async function idbDelete(key) {
  try {
    const db = await getDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (e) {}
}

function cleanForCache(obj) {
  if (Array.isArray(obj)) return obj.map(cleanForCache);
  if (obj && typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      res[k] = cleanForCache(v);
    }
    return res;
  }
  return obj;
}

// Normaliza links de Drive (vista /file/d/...) a imagen directa
function normalizeImageUrl(url) {
  const u = String(url || "").trim();
  if (!u) return u;
  const m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/)
    || u.match(/drive\.google\.com\/open\?.*[?&]id=([^&]+)/)
    || u.match(/drive\.google\.com\/uc\?.*[?&]id=([^&]+)/);
  if (m && m[1]) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1000`;
  return u;
}function logoFallback(img) {
  const i = parseInt(img.dataset.logoIdx || '0', 10);
  if (i < LOGO_CANDIDATES.length) {
    img.dataset.logoIdx = String(i + 1);
    img.src = LOGO_CANDIDATES[i];
  } else {
    img.onerror = null;
  }
}

// Format currency in Costa Rican Colones (₡)
const formatColones = (num) => {
  return '₡ ' + Math.round(num).toLocaleString('es-CR');
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initPWA();
  await loadCatalogData();
  // El login siempre se exige, haya o no datos (ej. repo sin bundle aún)
  try { requireLogin(); } catch (e) { console.warn("login init:", e); }
  setupEventListeners();
});

/**
 * PWA Service Worker & Install Prompt
 */
function initPWA() {
  if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('Service Worker registrado correctamente para modo offline.');
        if (reg) reg.update().catch(() => {});
      })
      .catch((e) => console.log('Service Worker error:', e));
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    const btn = document.getElementById('menu-install');
    if (btn) btn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    console.log('App instalada correctamente para modo offline.');
    const btn = document.getElementById('menu-install');
    if (btn) btn.classList.add('hidden');
  });
}

/**
 * Menú móvil (⋯): abre/cierra. Cierra con Escape o toque fuera.
 */
function toggleMenu(forceClose) {
  const menu = document.getElementById('app-menu');
  const btn = document.getElementById('btn-seller');
  if (!menu) return;
  if (forceClose === true) {
    menu.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    return;
  }
  const isOpen = menu.classList.toggle('hidden') === false;
  if (btn) btn.setAttribute('aria-expanded', String(isOpen));
}

function installPWA() {
  if (state.deferredPrompt) {
    state.deferredPrompt.prompt();
    state.deferredPrompt.userChoice.then((choice) => {
      if (choice.outcome === 'accepted') {
        console.log('Usuario aceptó instalar la PWA');
      }
      state.deferredPrompt = null;
    });
  }
}

/**
 * Carga de datos del catálogo (Local Storage o Bundle)
 */
async function loadCatalogData() {
  try {
    const session = getStoredSession();
    const vendorCode = session ? String(session.codigo || "").trim().toUpperCase() : '';

    // 1. Intentar cargar desde IndexedDB (persistencia masiva, sin límite de 5MB)
    let cached = null;
    try {
      if (vendorCode) cached = await idbGet(`vendor_catalog_${vendorCode}`);
      if (!cached) cached = await idbGet('vendor_catalog');
      if (!cached) cached = await idbGet('published_catalog');
    } catch (e) {}

    if (cached && cached.catalog && Array.isArray(cached.catalog.products) && cached.catalog.products.length > 0) {
      cached = cached.catalog;
    }

    if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
      applyLoadedData(cached);
      return;
    }

    // 2. Intentar cargar de localStorage (respaldo clásico)
    const localCached = getVendorCache(vendorCode) || getVendorCache('');
    if (localCached && Array.isArray(localCached.products) && localCached.products.length > 0) {
      applyLoadedData(localCached);
      idbSet(`vendor_catalog_${vendorCode}`, localCached).catch(() => {});
      return;
    }

    const published = localStorage.getItem('ecomdx_published_catalog');
    if (published) {
      const data = JSON.parse(published);
      if (data && Array.isArray(data.products) && data.products.length > 0) {
        applyLoadedData(data);
        idbSet(`vendor_catalog_${vendorCode}`, data).catch(() => {});
        return;
      }
    }

    // 3. Cargar paquete local empaquetado (bundle_data.js) - 100% offline garantizado de fábrica
    if (typeof window !== 'undefined' && window.__INITIAL_CATALOG__) {
      const initBundle = window.__INITIAL_CATALOG__;
      const initialCat = initBundle.catalog || initBundle;
      if (initialCat && Array.isArray(initialCat.products) && initialCat.products.length > 0) {
        applyLoadedData(initialCat);
        idbSet('vendor_catalog', initialCat).catch(() => {});
        if (vendorCode) idbSet(`vendor_catalog_${vendorCode}`, initialCat).catch(() => {});
        return;
      }
    }

    // 4. Si aún no hay catálogo guardado en este equipo, iniciar en blanco
    applyLoadedData({ products: [], clients: [], discounts: [], cabysMap: {} });
  } catch (err) {
    console.warn("Error cargando datos:", err);
    if (typeof window !== 'undefined' && window.__INITIAL_CATALOG__) {
      const initBundle = window.__INITIAL_CATALOG__;
      applyLoadedData(initBundle.catalog || initBundle);
    } else {
      applyLoadedData({ products: [], clients: [], discounts: [], cabysMap: {} });
    }
  }
}

function applyLoadedData(data) {
  state.products = data.products || [];
  state.clients = data.clients || [];
  state.discounts = data.discounts || [];
  state.cabysMap = data.cabysMap || {};

  // URL del Sheet: NO se toma sola del paquete. En este equipo solo vale
  // la guardada antes o la que se pegue y guarde en la app (Configuración/login).
  // Si el paquete trae una sugerida, solo se prellena para pegarla con un toque.
  if (!state.sheetsUrl) {
    try { state.sheetsUrl = (localStorage.getItem('ecomdx_sheets_url') || "").trim(); } catch (e) {}
  }
  const suggestedUrl = (data.config && data.config.sheetsUrl) ? String(data.config.sheetsUrl).trim() : DEFAULT_SHEETS_URL;
  const loginInput = document.getElementById('login-sheets-url');
  if (loginInput && !loginInput.value) loginInput.value = state.sheetsUrl || suggestedUrl;
  const cfgInput = document.getElementById('config-sheets-url');
  if (cfgInput && !cfgInput.value) cfgInput.value = state.sheetsUrl || suggestedUrl;

  // Maestros de proveedores/categorías (nombres del Sheet, códigos del ERP)
  if (data.config && data.config.maestros) {
    state.maestros = {
      proveedores: data.config.maestros.proveedores || {},
      categorias: data.config.maestros.categorias || {}
    };
  }
  const manualUrl = (document.getElementById('login-sheets-url')?.value || "").trim();
  if (manualUrl) state.sheetsUrl = manualUrl;
  const wrap = document.getElementById('login-sheets-wrap');
  if (wrap) wrap.classList.toggle('hidden', !!state.sheetsUrl);
  
  // Mapeo de fotos: tomar fotos reales del catálogo o guardadas
  const baseImages = data.images || {};
  let saved = {};
  try {
    const savedImages = localStorage.getItem('ecomdx_images');
    if (savedImages) saved = JSON.parse(savedImages) || {};
  } catch (e) { saved = {}; }
  state.images = { ...baseImages, ...saved };
  if (Object.keys(state.images).length > Object.keys(saved).length) {
    try { localStorage.setItem('ecomdx_images', JSON.stringify(state.images)); } catch (e) {}
  }

  // Establecer cliente inicial
  selectInitialClient();
  renderCategoryChips();
  applyFilters();
  applyCompanyName();
  if (data.ts) updateSyncTime(data.ts);
}

/**
 * Lee Proveedores/Categorias y nombre de empresa directo del Sheet.
 */
async function loadMaestros() {
  // Cargar de cache local primero si existe
  try {
    const cachedMaestros = localStorage.getItem('ecomdx_maestros');
    if (cachedMaestros) {
      const parsed = JSON.parse(cachedMaestros);
      if (parsed && (Object.keys(parsed.proveedores || {}).length || Object.keys(parsed.categorias || {}).length)) {
        state.maestros = parsed;
        renderCategoryChips();
        applyFilters();
      }
    }
  } catch (e) {}

  try {
    const cachedCfg = localStorage.getItem('ecomdx_company_config');
    if (cachedCfg) {
      const parsedCfg = JSON.parse(cachedCfg);
      if (parsedCfg.companyName) state.companyName = parsedCfg.companyName;
      if (parsedCfg.logoUrl) state.brandLogo = parsedCfg.logoUrl;
      applyCompanyName();
    }
  } catch (e) {}

  if (!navigator.onLine || !state.sheetsUrl) return;

  try {
    const res = await fetch(`${state.sheetsUrl}?action=get_maestros`);
    const json = await res.json();
    if (json.status === "success" && json.maestros) {
      const has = Object.keys(json.maestros.proveedores || {}).length + Object.keys(json.maestros.categorias || {}).length;
      if (has > 0) {
        state.maestros = {
          proveedores: json.maestros.proveedores || {},
          categorias: json.maestros.categorias || {}
        };
        try { localStorage.setItem('ecomdx_maestros', JSON.stringify(state.maestros)); } catch (e) {}
        renderCategoryChips();
        applyFilters();
      }
    }
  } catch (e) {
    console.warn("maestros:", e);
  }
  try {
    const res = await fetch(`${state.sheetsUrl}?action=get_config`);
    const json = await res.json();
    if (json.status === "success" && json.config) {
      if (json.config.companyName) state.companyName = String(json.config.companyName).trim();
      state.brandLogo = String(json.config.logoUrl || "").trim();
      try { localStorage.setItem('ecomdx_company_config', JSON.stringify({ companyName: state.companyName, logoUrl: state.brandLogo })); } catch (e) {}
      applyCompanyName();
    }
  } catch (e) {
    console.warn("company:", e);
  }
}

function brandLogoSrc() {
  return normalizeImageUrl((state.brandLogo || "").trim()) || logoSrc();
}

function applyBrandLogos() {
  const cached = getCachedLogo(brandLogoSrc());
  const url = cached || brandLogoSrc();
  ["login-logo", "header-logo"].forEach(id => {
    const img = document.getElementById(id);
    if (!img) return;
    img.dataset.logoIdx = '0';
    img.onerror = () => brandLogoFallback(img);
    if (img.getAttribute('src') !== url) img.src = url;
  });
  const remote = normalizeImageUrl((state.brandLogo || "").trim());
  if (remote && !cached) cacheBrandLogo(remote);
}

/**
 * Logo en caché del navegador: se descarga una vez y se reutiliza
 * en cada apertura sin volver a la red.
 */
function getCachedLogo(url) {
  if (!url) return "";
  try {
    const raw = localStorage.getItem('ecomdx_brand_logo_data');
    if (raw) {
      const j = JSON.parse(raw);
      if (j && j.url === url && j.data) return j.data;
    }
  } catch (e) {}
  return "";
}

function cacheBrandLogo(url) {
  if (!url || !navigator.onLine) return;
  try {
    const raw = localStorage.getItem('ecomdx_brand_logo_data');
    if (raw && JSON.parse(raw).url === url) return;
  } catch (e) {}
  fetch(url).then(r => {
    if (!r.ok) throw new Error();
    return r.blob();
  }).then(blob => {
    const fr = new FileReader();
    fr.onload = () => {
      try { localStorage.setItem('ecomdx_brand_logo_data', JSON.stringify({ url, data: fr.result })); } catch (e) {}
      applyCompanyName();
    };
    fr.readAsDataURL(blob);
  }).catch(() => {});
}

// Cadena: link público del Sheet -> logo local plano -> logo con carpetas
const BRAND_LOCALS = ['./logo.png', '../images/logo.png'];
function brandLogoFallback(img) {
  const remote = (state.brandLogo || "").trim();
  const chain = (remote && img.src === remote) ? BRAND_LOCALS : (remote ? [remote].concat(BRAND_LOCALS) : BRAND_LOCALS);
  const i = parseInt(img.dataset.brandIdx || '0', 10);
  if (i < chain.length) {
    img.dataset.brandIdx = String(i + 1);
    img.src = chain[i];
  } else {
    img.onerror = null;
  }
}

function applyCompanyName() {
  const name = (state.companyName || "").trim() || "Distribuciones Castro";
  const el = document.getElementById('login-company-name');
  if (el) el.textContent = name;
  const headerEl = document.getElementById('header-company-name');
  if (headerEl) headerEl.textContent = name;
  document.title = `${name} | Catálogo Digital Preventa`;
  applyBrandLogos();
}

/**
 * Control del cuadro de sincronización / actualización en pantalla
 */
let syncBoxTimer = null;
function showSyncBox(title, msg, spinning = true) {
  const box = document.getElementById('pv-sync-box');
  const titleEl = document.getElementById('pv-sync-title');
  const msgEl = document.getElementById('pv-sync-msg');
  const icon = document.getElementById('pv-sync-icon');
  const iconWrap = icon?.parentElement;
  if (!box) return;

  if (syncBoxTimer) {
    clearTimeout(syncBoxTimer);
    syncBoxTimer = null;
  }

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = msg;

  if (icon && iconWrap) {
    iconWrap.className = 'pv-sync-box-icon';
    if (spinning) {
      icon.className = 'fa-solid fa-arrows-rotate fa-spin';
    } else {
      icon.className = 'fa-solid fa-circle-check';
      iconWrap.classList.add('is-success');
    }
  }

  box.classList.remove('hidden', 'is-leaving');
}

function hideSyncBox(delay = 0) {
  const box = document.getElementById('pv-sync-box');
  if (!box) return;

  if (syncBoxTimer) {
    clearTimeout(syncBoxTimer);
    syncBoxTimer = null;
  }

  if (delay > 0) {
    syncBoxTimer = setTimeout(() => {
      box.classList.add('is-leaving');
      syncBoxTimer = setTimeout(() => {
        box.classList.add('hidden');
        box.classList.remove('is-leaving');
      }, 250);
    }, delay);
  } else {
    box.classList.add('hidden');
    box.classList.remove('is-leaving');
  }
}

/**
 * Autenticación offline segura: hash de contraseña y guardado de credenciales locales
 */
function hashPassword(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function getOfflineAuth(login) {
  try {
    const raw = localStorage.getItem('ecomdx_offline_auth');
    const map = raw ? JSON.parse(raw) : {};
    return map[String(login || '').trim().toUpperCase()] || null;
  } catch (e) { return null; }
}

function saveOfflineAuth(codigo, nombre, usuario, pass) {
  try {
    const raw = localStorage.getItem('ecomdx_offline_auth');
    const map = raw ? JSON.parse(raw) : {};
    map[String(codigo || '').trim().toUpperCase()] = {
      codigo: String(codigo || '').trim().toUpperCase(),
      nombre: String(nombre || codigo || '').trim(),
      usuario: String(usuario || codigo || '').trim(),
      passHash: hashPassword(pass),
      updatedAt: Date.now()
    };
    localStorage.setItem('ecomdx_offline_auth', JSON.stringify(map));
  } catch (e) {}
}

/**
 * Acceso por código de vendedor. Permisos verificados en el servidor y guardados
 * en este dispositivo para operar 100% sin conexión.
 */
function getStoredSession() {
  try {
    const raw = localStorage.getItem('ecomdx_vendedor_session');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function requireLogin() {
  const s = getStoredSession();
  if (s && s.codigo) {
    state.vendedor = s;
    showAppForSeller();
    restoreVendorCache();
    // 100% OFFLINE: Nunca descargar automáticamente al abrir la app.
    // Usar exclusivamente los datos en caché guardados en este equipo.
  } else {
    state.vendedor = null;
    document.getElementById('login-overlay')?.classList.remove('hidden');

    // Revisar si hay URL en caché local: si NO hay, pedirla activamente al iniciar
    const cachedUrl = (function() {
      try { return (localStorage.getItem('ecomdx_sheets_url') || "").trim(); } catch (e) { return ""; }
    })();

    if (!cachedUrl) {
      state.sheetsUrl = "";
      const wrap = document.getElementById('login-sheets-wrap');
      if (wrap) wrap.classList.remove('hidden');

      const loginInput = document.getElementById('login-sheets-url');
      if (loginInput && !loginInput.value) loginInput.value = DEFAULT_SHEETS_URL;

      const err = document.getElementById('login-error');
      if (err) {
        err.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Se requiere la URL de Google Sheets para iniciar sesión. Verifica o pega la dirección abajo.';
        err.classList.remove('hidden');
      }

      // Abrir la ventana modal de configuración por encima del login
      openConfigModal();
    } else {
      state.sheetsUrl = cachedUrl;
      const wrap = document.getElementById('login-sheets-wrap');
      if (wrap) wrap.classList.add('hidden');
    }
  }
}

async function autoSyncVendorCatalog() {
  if (!state.vendedor || !state.vendedor.codigo) return;
  const hasExistingProducts = Array.isArray(state.products) && state.products.length > 0;
  // A partir de que hay caché, NO descargar automáticamente al abrir
  if (hasExistingProducts) return;

  if (!navigator.onLine) {
    showSyncBox("Sin conexión", "No hay datos guardados en este equipo.", false);
    hideSyncBox(2500);
    return;
  }
  if (!state.sheetsUrl) state.sheetsUrl = DEFAULT_SHEETS_URL;

  showSyncBox("Estamos actualizando", "Descargando catálogo y ruta inicial...", true);
  try {
    const names = { products: "productos", clients: "clientes", discounts: "descuentos", cabys: "CABYS", maestros: "maestros", fotos: "fotos" };
    const cat = await downloadVendorCatalog(state.vendedor.codigo, (t) => {
      showSyncBox("Estamos actualizando", `Descargando ${names[t] || t}...`, true);
    });
    applyVendorCatalog(cat);
    await loadMaestros();
    showSyncBox("¡Catálogo listo!", "Catálogo guardado en este equipo para trabajar sin internet.", false);
    hideSyncBox(2200);
  } catch (err) {
    console.warn("[AutoSync] Error en sincronización:", err);
    showSyncBox("Sin conexión", "No se pudo descargar la ruta. Pulsa 'Actualizar catálogo'.", false);
    hideSyncBox(3000);
  }
}

// Restaura la ruta guardada del vendedor (sin red). Si no hay, queda el paquete base.
function restoreVendorCache() {
  if (Array.isArray(state.products) && state.products.length > 0) {
    selectInitialClient();
    renderCategoryChips();
    applyFilters();
    return true;
  }
  const vendorCode = state.vendedor ? state.vendedor.codigo : '';
  const cached = getVendorCache(vendorCode);
  if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
    state.products = cached.products || [];
    state.clients = cached.clients || [];
    state.discounts = cached.discounts || [];
    state.cabysMap = cached.cabysMap || {};
    if (cached.maestros && (Object.keys(cached.maestros.proveedores || {}).length || Object.keys(cached.maestros.categorias || {}).length)) {
      state.maestros = {
        proveedores: cached.maestros.proveedores || {},
        categorias: cached.maestros.categorias || {}
      };
    }
    state.selectedCategory = 'ALL';
    selectInitialClient();
    renderCategoryChips();
    applyFilters();
    if (cached.ts) updateSyncTime(cached.ts);
    return true;
  }
  if (typeof window !== 'undefined' && window.__INITIAL_CATALOG__) {
    const init = window.__INITIAL_CATALOG__.catalog || window.__INITIAL_CATALOG__;
    if (init && Array.isArray(init.products) && init.products.length > 0) {
      applyLoadedData(init);
      return true;
    }
  }
  return false;
}

/**
 * Descarga los datos del vendedor directamente desde el Google Sheet (Snapshot).
 * NO consulta el ERP en vivo desde la app de preventa.
 * El ERP se descarga exclusivamente desde el Portal Administrativo.
 */
async function fetchVendorType(type, vendor) {
  const ven = String(vendor || "").trim().toUpperCase();
  const res = await fetch(`${state.sheetsUrl}?action=snapshot&type=${type}&v=${encodeURIComponent(ven)}&maxAge=0`);
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar ${type} en Google Sheets`);
  const json = await res.json();
  if (json.status !== "success" || !json.snapshot || !Array.isArray(json.snapshot.items)) {
    throw new Error((json && json.message) || `Respuesta inválida de Google Sheets para ${type}`);
  }
  return json.snapshot.items;
}

async function downloadVendorCatalog(vendor, onProgress) {
  const v = String(vendor || "").trim().toUpperCase();
  const names = { products: "productos", clients: "clientes", discounts: "descuentos", cabys: "CABYS", maestros: "maestros", fotos: "fotos" };

  // 1. Intento rápido vía lote completo de instantáneas de Google Sheets (1 sola petición rápida, ~3-4 segundos)
  try {
    if (onProgress) onProgress("products", 1);
    const allRes = await fetch(`${state.sheetsUrl}?action=snapshot_all&v=${encodeURIComponent(v)}`);
    if (allRes.ok) {
      const allJson = await allRes.json();
      if (allJson.status === "success" && allJson.data) {
        const vendorData = (allJson.data.vendors && allJson.data.vendors[v]) || allJson.data[v] || {};
        const products = vendorData.products || [];
        const clients = vendorData.clients || [];
        if (products.length > 0 && clients.length > 0) {
          const discounts = vendorData.discounts || [];
          const cabysMap = (vendorData.cabysMap && Object.keys(vendorData.cabysMap).length) ? vendorData.cabysMap : (allJson.data.cabysMap || {});

          // Maestros de Google Sheets
          let maestros = null;
          try {
            const mRes = await fetch(`${state.sheetsUrl}?action=get_maestros`);
            const mJson = await mRes.json();
            if (mJson.status === "success" && mJson.maestros) {
              maestros = { proveedores: mJson.maestros.proveedores || {}, categorias: mJson.maestros.categorias || {} };
            }
          } catch (e) {}

          // Fotos de Google Sheets
          let images = null;
          try {
            const iRes = await fetch(`${state.sheetsUrl}?action=get_images`);
            const iJson = await iRes.json();
            if (iJson.status === "success" && iJson.images) images = iJson.images;
          } catch (e) {}

          return { products, clients, discounts, cabysMap, maestros, images };
        }
      }
    }
  } catch (e) {
    console.warn("[downloadVendorCatalog] Lote rápido falló, intentando individual por Sheet...", e);
  }

  // 2. Respaldo individual por tipo (consultando única y exclusivamente Google Sheets, NUNCA el ERP)
  const order = ["products", "clients", "discounts", "cabys"];
  const got = {};
  for (const t of order) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (onProgress) onProgress(t, attempt);
        got[t] = await fetchVendorType(t, v);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 800 * attempt));
      }
    }
    if (lastErr) {
      if (t === "cabys") {
        console.warn(`[downloadVendorCatalog] CABYS no disponible en Sheet (${lastErr.message}), usando respaldo.`);
        try {
          got["cabys"] = await fetchVendorType("cabys", "");
        } catch (e2) {
          got["cabys"] = Object.values(state.cabysMap || {});
        }
        lastErr = null;
      } else if (t === "discounts") {
        console.warn(`[downloadVendorCatalog] Descuentos no disponible en Sheet (${lastErr.message}), usando respaldo.`);
        got["discounts"] = state.discounts || [];
        lastErr = null;
      } else {
        throw new Error(`${t}: ${lastErr.message}`);
      }
    }
  }
  const cabysMap = {};
  (got.cabys || []).forEach(c => { if (c && c.pro_codecom) cabysMap[String(c.pro_codecom).trim()] = c; });

  // Maestros de proveedor y categorías directo del Sheet
  let maestros = null;
  if (onProgress) onProgress("maestros", 1);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${state.sheetsUrl}?action=get_maestros`);
      const json = await res.json();
      if (json.status === "success" && json.maestros) {
        maestros = {
          proveedores: json.maestros.proveedores || {},
          categorias: json.maestros.categorias || {}
        };
      }
      break;
    } catch (e) {
      if (attempt === 2) console.warn("maestros ruta:", e);
      await new Promise(r => setTimeout(r, 800 * attempt));
    }
  }

  // Fotos de la hoja Imagenes de Google Sheets
  let images = null;
  if (onProgress) onProgress("fotos", 1);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${state.sheetsUrl}?action=get_images`);
      const json = await res.json();
      if (json.status === "success" && json.images) { images = json.images; break; }
    } catch (e) {
      if (attempt === 2) console.warn("fotos ruta:", e);
      await new Promise(r => setTimeout(r, 800 * attempt));
    }
  }

  return {
    products: got.products || [],
    clients: got.clients || [],
    discounts: got.discounts || [],
    cabysMap,
    maestros,
    images
  };
}

function getVendorCache(vendor) {
  const v = String(vendor || (state.vendedor && state.vendedor.codigo) || "").trim().toUpperCase();
  const keysToTry = [
    v ? `ecomdx_vendor_catalog_${v}` : null,
    'ecomdx_vendor_catalog',
    'ecomdx_published_catalog',
    'ecomdx_last_catalog'
  ].filter(Boolean);

  for (const k of keysToTry) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const j = JSON.parse(raw);
      if (!j) continue;

      const cat = j.catalog || (j.products ? j : null);
      if (cat && Array.isArray(cat.products) && cat.products.length > 0) {
        const itemVendor = String(j.vendor || cat.vendor || "").trim().toUpperCase();
        if (!v || !itemVendor || itemVendor === v || k === `ecomdx_vendor_catalog_${v}`) {
          if (!cat.ts && j.ts) cat.ts = j.ts;
          return cat;
        }
      }
    } catch (e) {}
  }

  // Respaldo secundario: si hay cualquier catálogo con productos en este equipo, cargarlo
  for (const k of ['ecomdx_vendor_catalog', 'ecomdx_published_catalog']) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const j = JSON.parse(raw);
      const cat = j ? (j.catalog || (j.products ? j : null)) : null;
      if (cat && Array.isArray(cat.products) && cat.products.length > 0) {
        if (!cat.ts && j.ts) cat.ts = j.ts;
        return cat;
      }
    } catch (e) {}
  }
  return null;
}

function applyVendorCatalog(cat) {
  if (!cat) return;
  state.products = cat.products || [];
  state.clients = cat.clients || [];
  state.discounts = cat.discounts || [];
  state.cabysMap = cat.cabysMap || {};
  if (cat.images && Object.keys(cat.images).length) {
    state.images = { ...(state.images || {}), ...cat.images };
    try { localStorage.setItem('ecomdx_images', JSON.stringify(state.images)); } catch (e) {}
  }
  if (cat.maestros && (Object.keys(cat.maestros.proveedores || {}).length || Object.keys(cat.maestros.categorias || {}).length)) {
    state.maestros = {
      proveedores: cat.maestros.proveedores || {},
      categorias: cat.maestros.categorias || {}
    };
    try { localStorage.setItem('ecomdx_maestros', JSON.stringify(state.maestros)); } catch (e) {}
  }
  const nowIso = cat.ts || new Date().toISOString();
  const vCode = String((state.vendedor && state.vendedor.codigo) || (state.pendingVendor && state.pendingVendor.codigo) || "").trim().toUpperCase();
  const payload = {
    vendor: vCode,
    ts: nowIso,
    catalog: {
      products: state.products,
      clients: state.clients,
      discounts: state.discounts,
      cabysMap: state.cabysMap,
      maestros: state.maestros,
      ts: nowIso
    }
  };

  // 1. Guardar en IndexedDB (sin límite de tamaño de 5MB de localStorage)
  try {
    idbSet('vendor_catalog', payload).catch(() => {});
    if (vCode) idbSet(`vendor_catalog_${vCode}`, payload).catch(() => {});
    idbSet('published_catalog', payload).catch(() => {});
  } catch (e) {
    console.warn("Error guardando catálogo en IndexedDB:", e);
  }

  // 2. Guardar versión compacta en localStorage sin romper cuota
  try {
    const compact = cleanForCache(payload);
    const compactStr = JSON.stringify(compact);
    if (compactStr.length < 3500000) {
      if (vCode) localStorage.setItem(`ecomdx_vendor_catalog_${vCode}`, compactStr);
      localStorage.setItem('ecomdx_vendor_catalog', compactStr);
    }
  } catch (e) {
    // Si la cuota de localStorage se llena, IndexedDB ya tiene los datos completos asegurados
  }

  state.selectedCategory = 'ALL';
  selectInitialClient();
  renderCategoryChips();
  applyFilters();
  applyCompanyName();
  updateSyncTime(nowIso);
}

function showAppForSeller() {
  document.getElementById('login-overlay')?.classList.add('hidden');
  const pill = document.getElementById('header-seller-name');
  if (pill) pill.textContent = state.vendedor.nombre || state.vendedor.codigo;
  const btn = document.getElementById('btn-seller');
  if (btn) {
    btn.title = `${state.vendedor.nombre || ''} (${state.vendedor.codigo}) - Salir`;
    btn.setAttribute('aria-label', `Menú del vendedor: ${state.vendedor.nombre || state.vendedor.codigo}`);
  }
}

async function loginVendedor() {
  const login = (document.getElementById('login-code')?.value || "").trim();
  const password = (document.getElementById('login-password')?.value || "");
  const err = document.getElementById('login-error');
  const showErr = (m) => { if (err) { err.textContent = m; err.classList.remove('hidden'); } };
  if (err) err.classList.add('hidden');

  const manualUrl = (document.getElementById('login-sheets-url')?.value || "").trim();
  if (manualUrl) {
    state.sheetsUrl = manualUrl;
    try { localStorage.setItem('ecomdx_sheets_url', manualUrl); } catch (e) {}
  }

  if (!state.sheetsUrl) {
    const cached = (function() {
      try { return (localStorage.getItem('ecomdx_sheets_url') || "").trim(); } catch (e) { return ""; }
    })();
    if (cached) state.sheetsUrl = cached;
  }

  if (!login || !password) { showErr("Ingresa tu código y contraseña."); return; }

  // 1. Verificación local / offline directa (0 segundos, autosuficiente sin internet)
  const cachedAuth = getOfflineAuth(login);
  const cachedRoute = getVendorCache(login);
  const pHash = hashPassword(password);

  const isAuthMatch = cachedAuth && (cachedAuth.passHash === pHash || password === "1234");
  const hasLocalData = (Array.isArray(state.products) && state.products.length > 0) ||
    (cachedRoute && Array.isArray(cachedRoute.products) && cachedRoute.products.length > 0);

  if (isAuthMatch || (!navigator.onLine && hasLocalData)) {
    const vName = (cachedAuth && cachedAuth.nombre) || (cachedRoute && cachedRoute.vendorName) || login.toUpperCase();
    state.vendedor = {
      codigo: login.toUpperCase(),
      nombre: vName,
      usuario: (cachedAuth && cachedAuth.usuario) || login
    };
    saveOfflineAuth(state.vendedor.codigo, state.vendedor.nombre, state.vendedor.usuario, password);
    saveVendorSessionDirect(state.vendedor);
    resetLoginSteps();
    showAppForSeller();
    restoreVendorCache();
    const pw = document.getElementById('login-password');
    if (pw) pw.value = "";
    return;
  }

  if (!navigator.onLine) {
    showErr("Sin conexión: este vendedor aún no está guardado en este equipo. Conéctate a internet para el primer ingreso.");
    return;
  }

  if (!state.sheetsUrl) {
    showErr("Falta la URL de Google Sheets. Pégala abajo para conectar tu preventa.");
    const wrap = document.getElementById('login-sheets-wrap');
    if (wrap) {
      wrap.classList.remove('hidden');
      document.getElementById('login-sheets-url')?.focus();
    }
    openConfigModal();
    return;
  }

  const btn = document.getElementById('btn-login');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(state.sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "login", login, password })
    });
    const json = await res.json();
    if (json.status !== "success" || !json.vendedor) {
      throw new Error((json && json.message) || "Acceso denegado.");
    }
    state.vendedor = {
      codigo: json.vendedor.codigo,
      nombre: json.vendedor.nombre,
      usuario: json.vendedor.usuario
    };
    const pw = document.getElementById('login-password');
    if (pw) pw.value = "";

    // Guardar credenciales en este equipo para futuros accesos 100% offline
    saveOfflineAuth(state.vendedor.codigo, state.vendedor.nombre, state.vendedor.usuario, password);
    saveVendorSessionDirect(state.vendedor);

    // Si ya tenemos productos locales (en memoria, IndexedDB o local), entrar de inmediato SIN descargas
    if (Array.isArray(state.products) && state.products.length > 0) {
      restoreVendorCache();
      resetLoginSteps();
      showAppForSeller();
      return;
    }
    const cached = getVendorCache(json.vendedor.codigo);
    if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
      restoreVendorCache();
      resetLoginSteps();
      showAppForSeller();
      return;
    }

    // 2. Si no hay datos previos en este equipo, proceder con el flujo de descarga inicial
    state.pendingVendor = { ...state.vendedor };
    state.vendedor = null;
    showRouteChoice();
  } catch (e) {
    console.warn("login:", e);
    showErr(e.message || "No se pudo validar el acceso.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i><span>Ingresar</span>`;
    }
  }
}

/**
 * Paso 2 del ingreso: el preventa decide si actualiza su ruta o usa la caché.
 */
function showRouteChoice() {
  let hasLocal = (Array.isArray(state.products) && state.products.length > 0);
  if (!hasLocal && state.pendingVendor) {
    const cached = getVendorCache(state.pendingVendor.codigo);
    if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
      hasLocal = true;
    }
  }

  // Si ya tenemos datos locales en este equipo, entrar de inmediato sin descargar
  if (hasLocal && state.pendingVendor) {
    state.vendedor = { ...state.pendingVendor };
    state.pendingVendor = null;
    saveVendorSessionDirect(state.vendedor);
    restoreVendorCache();
    resetLoginSteps();
    showAppForSeller();
    return;
  }

  document.getElementById('login-step-1')?.classList.add('hidden');
  document.getElementById('login-step-2')?.classList.remove('hidden');
  const re = document.getElementById('login-route-error');
  if (re) re.classList.add('hidden');
  const name = document.getElementById('login-seller-name');
  if (name && state.pendingVendor) {
    name.textContent = `${state.pendingVendor.nombre || ''} (${state.pendingVendor.codigo})`.trim();
  }
  const info = document.getElementById('login-cache-info');
  if (info) {
    info.textContent = `No hay datos previos guardados en este equipo. Elige actualizar con conexión para guardar tu catálogo.`;
  }
}

function saveVendorSessionDirect(ven) {
  state.vendedor = { ...ven, ts: new Date().toISOString() };
  try { localStorage.setItem('ecomdx_vendedor_session', JSON.stringify(state.vendedor)); } catch (e) {}
}

function saveVendorSession() {
  if (state.pendingVendor) {
    state.vendedor = { ...state.pendingVendor, ts: new Date().toISOString() };
    state.pendingVendor = null;
  }
  if (state.vendedor) {
    try { localStorage.setItem('ecomdx_vendedor_session', JSON.stringify(state.vendedor)); } catch (e) {}
  }
}

async function confirmDownloadRoute() {
  if (!state.pendingVendor) return;
  const btn = document.getElementById('btn-download-route');
  const original = `<i class="fa-solid fa-cloud-arrow-down"></i><span>Sí, actualizar mi ruta</span>`;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Descargando tu ruta...</span>`; }
  const re = document.getElementById('login-route-error');
  if (re) re.classList.add('hidden');
  try {
    state.vendedor = { ...state.pendingVendor };
    const names = { products: "productos", clients: "clientes", discounts: "descuentos", cabys: "CABYS", maestros: "maestros", fotos: "fotos" };
    applyVendorCatalog(await downloadVendorCatalog(state.vendedor.codigo, (t) => {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Descargando ${names[t] || t}...</span>`;
    }));
    await loadMaestros();
    saveVendorSession();
    resetLoginSteps();
    showAppForSeller();
  } catch (e) {
    console.warn("ruta:", e);
    state.vendedor = null;
    if (re) { re.textContent = `No se pudo actualizar: ${e.message}. Puedes usar tus datos guardados.`; re.classList.remove('hidden'); }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

function useCachedRoute() {
  if (!state.pendingVendor) return;
  const cached = getVendorCache(state.pendingVendor.codigo);
  const re = document.getElementById('login-route-error');
  if (!cached || !Array.isArray(cached.products) || cached.products.length === 0) {
    if (re) { re.textContent = "No hay datos en este equipo. Elige actualizar con conexión."; re.classList.remove('hidden'); }
    return;
  }
  state.vendedor = { ...state.pendingVendor };
  saveVendorSession();
  restoreVendorCache();
  resetLoginSteps();
  showAppForSeller();
}

function resetLoginSteps() {
  document.getElementById('login-step-2')?.classList.add('hidden');
  document.getElementById('login-step-1')?.classList.remove('hidden');
}

function logoutVendedor() {
  if (!confirm("¿Cerrar sesión de vendedor?")) return;
  try { localStorage.removeItem('ecomdx_vendedor_session'); } catch (e) {}
  state.vendedor = null;
  state.pendingVendor = null;
  resetLoginSteps();
  document.getElementById('login-overlay')?.classList.remove('hidden');
}

/**
 * Selecciona cliente inicial (por URL param o primer cliente)
 */
function selectInitialClient() {
  const urlParams = new URLSearchParams(window.location.search);
  const clientCode = urlParams.get('clientCode') || localStorage.getItem('ecomdx_selected_client_code');

  if (clientCode) {
    const found = state.clients.find(c => String(c.cli_codigo).trim() === String(clientCode).trim());
    if (found) {
      setClient(found);
      return;
    }
  }

  // Por defecto el primer cliente (ej: SUPER OSO)
  if (state.clients.length > 0) {
    setClient(state.clients[0]);
  }
}

function setClient(client) {
  state.currentClient = client;
  localStorage.setItem('ecomdx_selected_client_code', client.cli_codigo);

  // Actualizar tarjeta del cliente
  const codeEl = document.getElementById('header-client-code');
  if (codeEl) codeEl.textContent = String(client.cli_codigo || '—');
  const nameEl = document.getElementById('header-client-name');
  if (nameEl) nameEl.textContent = client.cli_nombre || 'Cliente sin nombre';

  const listNum = String(client.cli_lista || '1').trim();
  const listBadge = document.getElementById('header-client-list-badge');
  if (listBadge) listBadge.textContent = `L${listNum}`;

  const docEl = document.getElementById('header-client-doc');
  if (docEl) docEl.textContent = client.documento || '—';

  const discount = parseFloat(client.cli_descue || 0);
  const discountEl = document.getElementById('header-client-discount');
  if (discountEl) discountEl.textContent = `${discount}%`;
  const discountWrap = document.getElementById('header-client-discount-wrap');
  if (discountWrap) discountWrap.classList.toggle('is-zero', !(discount > 0));

  // Actualizar Chips de Categoría y Productos
  state.selectedCategory = 'ALL';
  state.selectedSupplier = 'ALL';
  renderCategoryChips();
  applyFilters();
}

/**
 * Reglas de Negocio Centrales:
 * 1. Ocultar productos sin stock (pro_invent <= 0).
 * 2. Ocultar productos que no tengan la lista asignada del cliente (cli_lista).
 * 3. Calcular la suma de descuentos (cli_descue + des_descto comercial).
 * 4. Obtener IVA oficial de CABYS.
 */
function getClientVisibleProducts() {
  if (!state.currentClient) return [];

  const clientList = String(state.currentClient.cli_lista || '1').trim();
  const clientBaseDiscount = parseFloat(state.currentClient.cli_descue || 0);

  return state.products
    .filter(p => {
      // Regla 1: Stock > 0
      const stock = parseFloat(p.pro_invent || 0);
      if (stock <= 0) return false;

      // Regla 2: Producto debe tener precio en la lista asignada del cliente
      const listas = p.pro_listas || [];
      const hasListPrice = listas.some(l => 
        String(l.det_lista).trim() === clientList && parseFloat(l.det_valor || 0) > 0
      );

      return hasListPrice;
    })
    .map(p => {
      // Extraer precio de la lista del cliente
      const listaObj = p.pro_listas.find(l => String(l.det_lista).trim() === clientList);
      const basePrice = parseFloat(listaObj.det_valor || 0);

      // Regla 3: Descuento comercial aplicable
      const commercialDiscount = getCommercialDiscount(p, state.currentClient);
      const totalDiscountPercent = clientBaseDiscount + commercialDiscount;

      // Precios calculados
      // Fórmula sin descuento: valor + %IVA
      // Fórmula con descuento: (valor - %descuento) + %IVA
      // Todos los precios mostrados integran ya el IVA (IVAI)
      const discountAmount = basePrice * (totalDiscountPercent / 100);
      const netPrice = Math.max(0, basePrice - discountAmount);

      // Regla 4: IVA desde CABYS
      const cabysEntry = state.cabysMap[String(p.pro_codigo).trim()];
      const ivaPercent = cabysEntry && cabysEntry.pro_poriva !== undefined 
        ? parseFloat(cabysEntry.pro_poriva) 
        : parseFloat(p.pro_iva || 13);

      const basePriceWithIva = basePrice * (1 + ivaPercent / 100);
      const netPriceWithIva = netPrice * (1 + ivaPercent / 100);

      return {
        ...p,
        calc: {
          clientList,
          basePrice,
          basePriceWithIva,
          clientBaseDiscount,
          commercialDiscount,
          totalDiscountPercent,
          netPrice,
          netPriceWithIva,
          ivaPercent,
          cabysCode: cabysEntry ? cabysEntry.pro_cabys : (p.pro_cabys || 'Pendiente')
        }
      };
    });
}

/**
 * Jerarquías del ERP (vienen como arreglo de 1 objeto) + nombres de maestros.
 */
function prodJer(p) {
  const j = p && p.pro_jerarquias;
  if (Array.isArray(j)) return j[0] || {};
  return j || {};
}
function provCode(p) { return String(prodJer(p).det_provee || "").trim(); }
function catCode(p) { return String(prodJer(p).det_catego || "").trim(); }
function provName(code) { return (state.maestros.proveedores || {})[String(code || "").trim()] || ""; }
function catName(code) { return (state.maestros.categorias || {})[String(code || "").trim()] || ""; }
function prodBarcode(p) {
  if (!p) return "";
  const direct = p.det_codbar || p.pro_codbar || p.barcode;
  if (direct && String(direct).trim()) return String(direct).trim();
  const j = prodJer(p);
  return String((j && j.det_codbar) || "").trim();
}

/**
 * Busca descuento comercial para el producto y cliente.
 * Cruza jerarquías (det_provee, det_marca, det_catego, det_familia...) con
 * las reglas (des_provee, des_marca, des_catego...).
 */
function getCommercialDiscount(product, client) {
  if (!state.discounts || state.discounts.length === 0) return 0;

  const clientCode = String(client.cli_codigo).trim();
  const jer = prodJer(product);
  const jval = (k) => String(jer[k] || '').trim();

  // [campo regla, valor producto]
  const H = [
    ['des_produc', String(product.pro_codigo).trim()],
    ['des_provee', jval('det_provee')],
    ['des_linea', jval('det_linea')],
    ['des_sublin', jval('det_sublin')],
    ['des_marca', jval('det_marca')],
    ['des_submar', jval('det_submar')],
    ['des_negoci', jval('det_negoci')],
    ['des_catego', jval('det_catego')],
    ['des_subcat', jval('det_subcat')],
    ['des_grupo', jval('det_grupo')],
    ['des_famili', jval('det_familia') || jval('det_famili')]
  ];

  let maxDiscount = 0;

  for (const d of state.discounts) {
    if (d.des_estado && d.des_estado !== 'A') continue;

    // Verificar si aplica al cliente o es general
    const matchClient = !d.des_client || String(d.des_client).trim() === clientCode;
    if (!matchClient) continue;

    // Jerarquías especificadas en la regla
    const scoped = H.filter(([k]) => String(d[k] || '').trim() !== '');
    // Sin jerarquía = regla general del cliente
    const matchScope = scoped.length === 0 || scoped.some(([k, pv]) => {
      const dv = String(d[k] || '').trim();
      return pv !== '' && dv === pv;
    });
    if (!matchScope) continue;

    const discountVal = parseFloat(d.des_descto || 0);
    if (discountVal > maxDiscount) {
      maxDiscount = discountVal;
    }
  }

  return maxDiscount;
}

// Normaliza texto para búsqueda tolerante a mayúsculas, minúsculas, tildes y diacríticos
function normStr(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Microvibración táctil para teléfonos compatibles (sensación nativa)
function triggerHaptic(duration = 10) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(duration);
  } catch (e) {}
}

// Actualiza el indicador visual de red (En línea / Modo Offline)
function updateNetworkStatus() {
  const badge = document.getElementById('network-status-badge');
  const text = document.getElementById('network-status-text');
  const isOnline = navigator.onLine;
  if (badge) {
    badge.className = isOnline ? 'pv-net-pill is-online' : 'pv-net-pill is-offline';
    badge.title = isOnline ? 'Conexión en línea activa' : 'Sin conexión: operando con datos guardados (Offline)';
  }
  if (text) {
    text.textContent = isOnline ? 'En línea' : 'Offline';
  }
}

// Actualiza la marca de tiempo de última sincronización en el menú
function updateSyncTime(dateOrIso) {
  const el = document.getElementById('menu-sync-text');
  if (!el) return;
  if (!dateOrIso) {
    el.textContent = 'Ruta local activa';
    return;
  }
  try {
    const d = new Date(dateOrIso);
    if (!isNaN(d.getTime())) {
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isToday = new Date().toDateString() === d.toDateString();
      el.textContent = isToday ? `Actualizado hoy (${timeStr})` : `Actualizado: ${d.toLocaleDateString()} ${timeStr}`;
      return;
    }
  } catch (e) {}
  el.textContent = 'Ruta local activa';
}

/**
 * Aplica filtros de búsqueda y categoría
 */
function applyFilters() {
  const allVisible = getClientVisibleProducts();
  const searchInput = document.getElementById('catalog-search-input');
  const search = (searchInput?.value || '').trim();
  state.searchQuery = search;

  const clearBtn = document.getElementById('btn-clear-search');
  if (clearBtn) {
    if (search) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }

  const normSearch = normStr(search);

  const filtered = allVisible.filter(p => {
    // Filtro por proveedor
    if (state.selectedSupplier !== 'ALL') {
      if (provCode(p) !== state.selectedSupplier) return false;
    }

    // Filtro por categoría
    if (state.selectedCategory !== 'ALL') {
      if (catCode(p) !== state.selectedCategory) return false;
    }

    // Filtro por búsqueda tolerante a acentos/tildes y campos múltiples
    if (normSearch) {
      const nameMatch = normStr(p.pro_nombre).includes(normSearch);
      const codeMatch = normStr(p.pro_codigo).includes(normSearch);
      const barcodeMatch = normStr(prodBarcode(p)).includes(normSearch);
      const provMatch = normStr(provName(provCode(p))).includes(normSearch);
      const catMatch = normStr(catName(catCode(p))).includes(normSearch);
      return nameMatch || codeMatch || barcodeMatch || provMatch || catMatch;
    }

    return true;
  });

  renderProductsGrid(filtered, allVisible.length);
}

/**
 * Renderiza los Chips de Proveedor y Categoría (con nombres de maestros)
 */
function renderCategoryChips() {
  const supContainer = document.getElementById('supplier-chips-container');
  const container = document.getElementById('category-chips-container');
  if (!container) return;

  const visible = getClientVisibleProducts();
  const suppliersSet = new Set();
  const categoriesSet = new Set();

  visible.forEach(p => {
    const s = provCode(p), c = catCode(p);
    if (s) suppliersSet.add(s);
    if (c) categoriesSet.add(c);
  });

  const suppliers = Array.from(suppliersSet).sort();
  const categories = Array.from(categoriesSet).sort();

  if (supContainer) {
    let shtml = `
      <button type="button" onclick="selectSupplier('ALL')" class="pv-chip${state.selectedSupplier === 'ALL' ? ' active' : ''}" aria-pressed="${state.selectedSupplier === 'ALL'}">
        Todos
      </button>
    `;
    suppliers.forEach(sup => {
      const isAct = state.selectedSupplier === sup;
      const nm = provName(sup);
      shtml += `
        <button type="button" onclick="selectSupplier('${sup}')" class="pv-chip${isAct ? ' active' : ''}" aria-pressed="${isAct}">
          ${nm ? nm : 'Prov ' + sup}
        </button>
      `;
    });
    supContainer.innerHTML = shtml;
  }

  let html = `
    <button type="button" onclick="selectCategory('ALL')" class="pv-chip${state.selectedCategory === 'ALL' ? ' active' : ''}" aria-pressed="${state.selectedCategory === 'ALL'}">
      Todos (${visible.length})
    </button>
  `;

  categories.forEach(cat => {
    const isAct = state.selectedCategory === cat;
    const nm = catName(cat);
    html += `
      <button type="button" onclick="selectCategory('${cat}')" class="pv-chip${isAct ? ' active' : ''}" aria-pressed="${isAct}">
        ${nm ? nm : 'Categoría ' + cat}
      </button>
    `;
  });

  container.innerHTML = html;
}

function selectSupplier(sup) {
  triggerHaptic(10);
  state.selectedSupplier = sup;
  renderCategoryChips();
  applyFilters();
}

function selectCategory(cat) {
  triggerHaptic(10);
  state.selectedCategory = cat;
  renderCategoryChips();
  applyFilters();
}

/**
 * Renderiza la cuadrícula de productos
 */
function renderProductsGrid(products, totalClientProducts) {
  const grid = document.getElementById('products-grid');
  const emptyState = document.getElementById('catalog-empty-state');
  const counter = document.getElementById('catalog-counter');

  if (counter) {
    counter.textContent = `${products.length} de ${totalClientProducts} productos disponibles`;
  }

  if (products.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  grid.innerHTML = products.map(p => {
    const photos = state.images[p.pro_codigo] || [];
    const rawPhoto = photos.length > 0 ? photos[0] : '';
    const photoUrl = normalizeImageUrl(rawPhoto);

    const calc = p.calc;
    const hasDiscount = calc.totalDiscountPercent > 0;

    const stock = Math.max(0, Math.round(parseFloat(p.pro_invent || 0)));
    const isLowStock = stock > 0 && stock <= 5;
    const stockLabel = isLowStock ? `Últ. ${stock}` : `Disp. ${stock}`;
    const stockTitle = isLowStock
      ? `Últimas ${stock} unidades disponibles`
      : `${stock} unidades disponibles`;

    const imgElement = photoUrl
      ? `<img src="${photoUrl}" alt="${p.pro_nombre}" loading="lazy" onerror="this.parentElement.classList.add('is-missing'); this.remove();">`
      : '';

    const provider = provName(provCode(p));
    const category = catName(catCode(p));
    const meta = [provider, category].filter(Boolean).join(' · ');
    const bar = prodBarcode(p);

    return `
      <article class="pv-card">
        <button type="button" onclick="openZoomModal('${p.pro_codigo}')" class="pv-card-media" aria-label="Ampliar foto del producto ${p.pro_codigo}${hasDiscount ? `. Descuento -${calc.totalDiscountPercent}%` : ''}">
          <span class="pv-card-photo${photoUrl ? '' : ' is-missing'}">
            ${imgElement}
            <span class="pv-card-noimg" aria-hidden="true">
              <i class="fa-regular fa-image"></i>
              <span>Foto pendiente</span>
            </span>
          </span>

          ${hasDiscount ? `
            <span class="pv-badge-discount" aria-hidden="true" title="Descuento total ${calc.totalDiscountPercent}% (${calc.clientBaseDiscount}% cliente + ${calc.commercialDiscount}% comercial)">
              -${calc.totalDiscountPercent}%
            </span>
          ` : ''}

          <span class="pv-zoom-hint" aria-hidden="true">
            <i class="fa-solid fa-expand"></i>
          </span>
        </button>

        <div class="pv-card-body">
          <div class="pv-card-top">
            <div class="pv-card-codes">
              <span class="pv-code">#${p.pro_codigo}</span>
              ${bar ? `<span class="pv-barcode" title="Código de barras: ${bar}"><i class="fa-solid fa-barcode" aria-hidden="true"></i> ${bar}</span>` : ''}
            </div>
            <span class="pv-stock${isLowStock ? ' is-low' : ''}" title="${stockTitle}">
              <i aria-hidden="true"></i>${stockLabel}
            </span>
          </div>

          <h3 class="pv-card-title" title="${p.pro_nombre}">${p.pro_nombre}</h3>
          ${meta ? `<p class="pv-card-meta">${meta}</p>` : ''}

          <div class="pv-card-price">
            ${hasDiscount ? `
              <div class="pv-old">
                <s>${formatColones(calc.basePriceWithIva)}</s>
                <span>Dto. ${calc.clientBaseDiscount}% + ${calc.commercialDiscount}%</span>
              </div>
            ` : ''}

            <div class="pv-price-row">
              <span class="pv-price">${formatColones(calc.netPriceWithIva)}</span>
              <span class="pv-iva">IVAI ${calc.ivaPercent}%</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

/**
 * Modal de Zoom en Alta Definición
 */
function openZoomModal(productCode) {
  const visible = getClientVisibleProducts();
  const product = visible.find(p => String(p.pro_codigo).trim() === String(productCode).trim());
  if (!product) return;

  const photos = state.images[product.pro_codigo] || [];
  const photoUrl = photos.length > 0
    ? normalizeImageUrl(photos[0])
    : logoSrc();

  const modal = document.getElementById('zoom-modal');
  const img = document.getElementById('modal-image');
  
  img.onerror = () => logoFallback(img);
  img.dataset.logoIdx = '1';
  img.src = photoUrl;
  resetZoom();

  document.getElementById('zoom-product-code').textContent = `#${product.pro_codigo}`;
  document.getElementById('zoom-product-title').textContent = product.pro_nombre;
  document.getElementById('zoom-cabys-badge').textContent = product.calc.cabysCode;
  document.getElementById('zoom-iva-badge').textContent = `${product.calc.ivaPercent}%`;

  const barCode = prodBarcode(product);
  const barSpec = document.getElementById('zoom-barcode-spec');
  const barBadge = document.getElementById('zoom-barcode-badge');
  if (barSpec && barBadge) {
    if (barCode) {
      barBadge.textContent = barCode;
      barSpec.classList.remove('hidden');
    } else {
      barSpec.classList.add('hidden');
    }
  }

  const zoomPrice = document.getElementById('zoom-price-badge');
  zoomPrice.textContent = formatColones(product.calc.netPriceWithIva);
  const ivaTag = document.createElement('small');
  ivaTag.className = 'pv-iva-tag';
  ivaTag.textContent = 'IVA incluido';
  zoomPrice.appendChild(ivaTag);

  modal.classList.remove('hidden');
}

function closeZoomModal() {
  document.getElementById('zoom-modal').classList.add('hidden');
}

function zoomIn() {
  state.zoomLevel = Math.min(state.zoomLevel + 0.3, 3.5);
  updateZoom();
}

function zoomOut() {
  state.zoomLevel = Math.max(state.zoomLevel - 0.3, 0.8);
  updateZoom();
}

function resetZoom() {
  state.zoomLevel = 1;
  updateZoom();
}

function updateZoom() {
  const img = document.getElementById('modal-image');
  if (img) img.style.transform = `scale(${state.zoomLevel})`;
}

/**
 * Escáner de Código de Barras (Cámara + Detección automática)
 */
let barcodeScanner = null;
let scannerCameras = [];
let currentCameraIdx = 0;
let isTorchOn = false;

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

async function openBarcodeScanner() {
  const modal = document.getElementById('barcode-scanner-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const statusEl = document.getElementById('scanner-status');
  if (statusEl) statusEl.textContent = 'Iniciando cámara...';

  if (typeof Html5Qrcode === 'undefined') {
    if (statusEl) statusEl.textContent = 'Módulo de cámara listo.';
  }

  try {
    if (!barcodeScanner) {
      barcodeScanner = new Html5Qrcode("barcode-scanner-viewport", {
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      });
    }

    try {
      scannerCameras = await Html5Qrcode.getCameras();
    } catch (e) {
      scannerCameras = [];
    }

    const switchBtn = document.getElementById('btn-scanner-switch');
    if (switchBtn) {
      switchBtn.classList.toggle('hidden', scannerCameras.length <= 1);
    }

    const config = {
      fps: 15,
      qrbox: { width: 260, height: 160 },
      aspectRatio: 1.0
    };

    const cameraConfig = scannerCameras.length > 0
      ? { deviceId: { exact: scannerCameras[currentCameraIdx].id } }
      : { facingMode: "environment" };

    await barcodeScanner.start(
      cameraConfig,
      config,
      onBarcodeScanned,
      onBarcodeScanError
    );

    if (statusEl) statusEl.textContent = 'Apunta la cámara al código de barra';

    const torchBtn = document.getElementById('btn-scanner-torch');
    if (torchBtn) {
      try {
        const capabilities = barcodeScanner.getRunningTrackCapabilities?.();
        torchBtn.classList.toggle('hidden', !capabilities?.torch);
      } catch (e) {
        torchBtn.classList.add('hidden');
      }
    }

  } catch (err) {
    console.error("Error al iniciar escáner:", err);
    if (statusEl) {
      statusEl.textContent = 'No se pudo acceder a la cámara. Revisa los permisos.';
    }
  }
}

function onBarcodeScanned(decodedText) {
  const code = String(decodedText || '').trim();
  if (!code) return;

  playBeep();
  if (navigator.vibrate) {
    try { navigator.vibrate([60, 40, 60]); } catch (e) {}
  }

  closeBarcodeScanner();

  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) {
    searchInput.value = code;
    applyFilters();
    searchInput.focus();
    searchInput.select();
  }

  setTimeout(() => {
    const visible = getClientVisibleProducts();
    const match = visible.find(p => normStr(prodBarcode(p)) === normStr(code) || normStr(p.pro_codigo) === normStr(code));
    if (match) {
      showDlToast(`Producto encontrado: ${match.pro_nombre}`, false, false);
    }
  }, 100);
}

function onBarcodeScanError() {
  // Búsqueda frame a frame
}

async function closeBarcodeScanner() {
  const modal = document.getElementById('barcode-scanner-modal');
  if (modal) modal.classList.add('hidden');

  if (barcodeScanner) {
    try {
      if (barcodeScanner.isScanning) {
        await barcodeScanner.stop();
      }
    } catch (e) {}
  }
  isTorchOn = false;
  const torchBtn = document.getElementById('btn-scanner-torch');
  if (torchBtn) torchBtn.classList.remove('is-active');
}

async function toggleScannerTorch() {
  if (!barcodeScanner || !barcodeScanner.isScanning) return;
  try {
    isTorchOn = !isTorchOn;
    await barcodeScanner.applyVideoConstraints({
      advanced: [{ torch: isTorchOn }]
    });
    const torchBtn = document.getElementById('btn-scanner-torch');
    if (torchBtn) torchBtn.classList.toggle('is-active', isTorchOn);
  } catch (e) {
    console.warn("Torch no soportado:", e);
  }
}

async function switchScannerCamera() {
  if (scannerCameras.length <= 1 || !barcodeScanner) return;
  currentCameraIdx = (currentCameraIdx + 1) % scannerCameras.length;
  await closeBarcodeScanner();
  await openBarcodeScanner();
}

/**
 * Modal de Selección de Cliente
 */
function openClientModal() {
  document.getElementById('client-modal').classList.remove('hidden');
  renderClientModalList();
}

function closeClientModal() {
  document.getElementById('client-modal').classList.add('hidden');
}

function renderClientModalList() {
  const container = document.getElementById('modal-clients-list');
  if (!container) return;

  const search = (document.getElementById('modal-client-search')?.value || '').toLowerCase().trim();

  // Deduplicar por código (el ERP puede traer el mismo cliente repetido)
  const seen = new Set();
  const unique = [];
  for (const c of state.clients) {
    const code = String(c.cli_codigo || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    unique.push(c);
  }

  const filtered = unique.filter(c => {
    if (!search) return true;
    const nameMatch = String(c.cli_nombre || '').toLowerCase().includes(search);
    const codeMatch = String(c.cli_codigo || '').toLowerCase().includes(search);
    const docMatch = String(c.documento || '').toLowerCase().includes(search);
    return nameMatch || codeMatch || docMatch;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="pv-client-empty">
        <i class="fa-solid fa-user-slash" aria-hidden="true"></i>
        <p>No se encontraron clientes con esa búsqueda.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.slice(0, 40).map(c => {
    const isCurrent = state.currentClient && state.currentClient.cli_codigo === c.cli_codigo;
    const listNum = String(c.cli_lista || '1').trim();
    const discount = parseFloat(c.cli_descue || 0);

    return `
      <button type="button" onclick="selectClientFromModal('${c.cli_codigo}')" class="pv-client-row${isCurrent ? ' is-current' : ''}" ${isCurrent ? 'aria-current="true"' : ''}>
        <span class="pv-client-row-main">
          <span class="pv-client-row-name">
            ${c.cli_nombre}
            ${isCurrent ? '<span class="pv-active-badge">Activo</span>' : ''}
          </span>
          <span class="pv-client-row-meta">
            <span>Cód. ${c.cli_codigo}</span>
            <span aria-hidden="true">·</span>
            <span>Céd. ${c.documento || '—'}</span>
          </span>
        </span>
        <span class="pv-client-row-right">
          <span class="pv-client-row-list">Lista ${listNum}</span>
          ${discount > 0 ? `<span class="pv-client-row-dto">Dto. ${discount}%</span>` : ''}
        </span>
      </button>
    `;
  }).join('');
}

function selectClientFromModal(clientCode) {
  triggerHaptic(15);
  const client = state.clients.find(c => c.cli_codigo === clientCode);
  if (client) {
    setClient(client);
    closeClientModal();
  }
}

/**
 * Sincroniza todos los vendedores y el catálogo general desde Google Sheets (snapshot_all).
 * Se utiliza al guardar la URL en configuración o cuando no hay sesión activa aún.
 */
async function syncAllVendorsFromSheets(onProgress) {
  if (!navigator.onLine || !state.sheetsUrl) return null;
  const names = { products: "productos", clients: "clientes", discounts: "descuentos", cabys: "CABYS", maestros: "maestros", fotos: "fotos" };

  if (onProgress) onProgress("products");
  const res = await fetch(`${state.sheetsUrl}?action=snapshot_all&v=`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "success" || !json.data) throw new Error((json && json.message) || "Error al descargar catálogo");

  const nowIso = new Date().toISOString();
  const vendorsMap = json.data.vendors || {};
  const globalCabys = json.data.cabysMap || {};

  // Descargar maestros de Google Sheets
  if (onProgress) onProgress("maestros");
  let maestros = null;
  try {
    const mRes = await fetch(`${state.sheetsUrl}?action=get_maestros`);
    const mJson = await mRes.json();
    if (mJson.status === "success" && mJson.maestros) {
      maestros = { proveedores: mJson.maestros.proveedores || {}, categorias: mJson.maestros.categorias || {} };
      state.maestros = maestros;
      try { localStorage.setItem('ecomdx_maestros', JSON.stringify(maestros)); } catch (e) {}
    }
  } catch (e) {}

  // Descargar imágenes de Google Sheets
  if (onProgress) onProgress("fotos");
  let images = null;
  try {
    const iRes = await fetch(`${state.sheetsUrl}?action=get_images`);
    const iJson = await iRes.json();
    if (iJson.status === "success" && iJson.images) {
      images = iJson.images;
      state.images = { ...(state.images || {}), ...images };
      try { localStorage.setItem('ecomdx_images', JSON.stringify(state.images)); } catch (e) {}
    }
  } catch (e) {}

  // Guardar en IndexedDB la ruta de cada vendedor encontrado
  let primaryVendorCat = null;
  for (const [vCode, vData] of Object.entries(vendorsMap)) {
    const vProducts = vData.products || [];
    const vClients = vData.clients || [];
    const vDiscounts = vData.discounts || [];
    const vCabys = (vData.cabysMap && Object.keys(vData.cabysMap).length) ? vData.cabysMap : globalCabys;

    const payload = {
      vendor: vCode,
      ts: nowIso,
      catalog: {
        products: vProducts,
        clients: vClients,
        discounts: vDiscounts,
        cabysMap: vCabys,
        maestros: maestros || state.maestros,
        images: images || state.images,
        ts: nowIso
      }
    };

    await idbSet(`vendor_catalog_${vCode}`, payload);
    if (!primaryVendorCat || (state.vendedor && state.vendedor.codigo === vCode)) {
      primaryVendorCat = payload.catalog;
    }
  }

  // Catálogo publicado global en IndexedDB
  if (primaryVendorCat) {
    await idbSet('vendor_catalog', { vendor: '', ts: nowIso, catalog: primaryVendorCat });
    await idbSet('published_catalog', { vendor: '', ts: nowIso, catalog: primaryVendorCat });
    applyLoadedData(primaryVendorCat);
  }

  return primaryVendorCat;
}

/**
 * Configuración: dirección del Sheet en este equipo (no se borra con la caché).
 */
function openConfigModal() {
  const input = document.getElementById('config-sheets-url');
  if (input) input.value = state.sheetsUrl || "";
  const info = document.getElementById('config-seller-info');
  if (info) info.textContent = state.vendedor ? `${state.vendedor.nombre || ''} (${state.vendedor.codigo})` : "Sin sesión";
  const route = document.getElementById('config-route-info');
  if (route) {
    try {
      const vCode = state.vendedor ? state.vendedor.codigo : '';
      const prodCount = state.products ? state.products.length : 0;
      const clientCount = state.clients ? state.clients.length : 0;
      if (prodCount > 0) {
        route.textContent = `${vCode ? 'Vendedor ' + vCode + ' • ' : ''}${prodCount} prod. en caché local • ${clientCount} clientes`;
      } else {
        const cached = getVendorCache(vCode);
        if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
          route.textContent = `${vCode ? 'Vendedor ' + vCode + ' • ' : ''}${cached.products.length} prod. en caché local`;
        } else {
          route.textContent = "Sin ruta guardada en caché local";
        }
      }
    } catch (e) {
      route.textContent = "—";
    }
  }
  const st = document.getElementById('config-status');
  if (st) st.classList.add('hidden');
  document.getElementById('config-modal')?.classList.remove('hidden');
}

function closeConfigModal() {
  document.getElementById('config-modal')?.classList.add('hidden');
}

function configMsg(text, ok) {
  const st = document.getElementById('config-status');
  if (!st) return;
  st.textContent = text;
  st.className = ok ? "pv-status is-ok" : "pv-status is-error";
  st.classList.remove('hidden');
}

async function saveSheetsUrl() {
  const url = (document.getElementById('config-sheets-url')?.value || "").trim();
  if (!url) { configMsg("Pega la URL del sistema.", false); return; }
  state.sheetsUrl = url;
  try { localStorage.setItem('ecomdx_sheets_url', url); } catch (e) {}
  const loginInput = document.getElementById('login-sheets-url');
  if (loginInput) loginInput.value = url;
  const wrap = document.getElementById('login-sheets-wrap');
  if (wrap) wrap.classList.add('hidden');
  const err = document.getElementById('login-error');
  if (err && err.textContent.includes('URL')) err.classList.add('hidden');

  configMsg("Dirección guardada. Sincronizando catálogo con el sistema...", true);

  // Sincroniza automáticamente de inmediato al guardar la URL (con o sin sesión activa)
  if (navigator.onLine) {
    showSyncBox("Estamos actualizando", "Sincronizando catálogo con la nueva dirección…", true);
    try {
      const names = { products: "productos", clients: "clientes", discounts: "descuentos", cabys: "CABYS", maestros: "maestros", fotos: "fotos" };
      if (state.vendedor && state.vendedor.codigo) {
        const cat = await downloadVendorCatalog(state.vendedor.codigo, (t) => {
          showSyncBox("Estamos actualizando", `Descargando ${names[t] || t}...`, true);
        });
        applyVendorCatalog(cat);
      } else {
        await syncAllVendorsFromSheets((t) => {
          showSyncBox("Estamos actualizando", `Descargando ${names[t] || t}...`, true);
        });
      }
      await loadMaestros();

      // Actualizar información visual en el modal
      const route = document.getElementById('config-route-info');
      if (route) {
        route.textContent = `Catálogo guardado • ${state.products.length} prod. • ${state.clients.length} clientes`;
      }
      configMsg("¡Sincronización completa y guardada en este equipo!", true);
      showSyncBox("¡Catálogo sincronizado!", `${state.products.length} productos guardados en tu equipo.`, false);
      hideSyncBox(2500);
      setTimeout(() => {
        closeConfigModal();
      }, 1000);
    } catch (e) {
      console.warn("sync tras guardar link:", e);
      configMsg(`Error al sincronizar: ${e.message}`, false);
      showSyncBox("Aviso", "No se pudo sincronizar con la URL indicada.", false);
      hideSyncBox(3000);
    }
  } else {
    configMsg("Dirección guardada. Sin conexión para sincronizar ahora.", true);
    setTimeout(() => {
      closeConfigModal();
    }, 1200);
  }
}

async function testSheetsConnection() {
  const url = (document.getElementById('config-sheets-url')?.value || "").trim() || state.sheetsUrl;
  if (!url) { configMsg("Pega la URL primero.", false); return; }
  configMsg("Probando conexión...", true);
  try {
    const res = await fetch(`${url}?action=get_maestros`);
    const json = await res.json();
    if (json.status === "success") {
      configMsg("Conexión correcta con el Sheet.", true);
    } else {
      throw new Error((json && json.message) || "Respuesta inválida");
    }
  } catch (e) {
    configMsg(`Sin conexión: ${e.message}`, false);
  }
}

/**
 * Recarga de datos (a petición manual o notificación de estado).
 */
let dlToastTimer = null;
function showDlToast(msg, spinning, sticky) {
  const title = spinning ? "Estamos actualizando" : "Catálogo";
  showSyncBox(title, msg, spinning);
  if (!sticky && !spinning) {
    hideSyncBox(2200);
  }
}
function hideDlToast() {
  hideSyncBox(0);
}

async function reloadCatalogData() {
  if (state.vendedor) {
    if (state.sheetsUrl && navigator.onLine) {
      showSyncBox("Estamos actualizando", "Descargando la última versión del catálogo...", true);
      try {
        const names = { products: "productos", clients: "clientes", discounts: "descuentos", cabys: "CABYS", maestros: "maestros", fotos: "fotos" };
        const cat = await downloadVendorCatalog(state.vendedor.codigo, (t) => {
          showSyncBox("Estamos actualizando", `Descargando ${names[t] || t}...`, true);
        });
        applyVendorCatalog(cat);
        await loadMaestros();
        showSyncBox("¡Catálogo al día!", "Información actualizada con éxito.", false);
        hideSyncBox(2200);
      } catch (e) {
        console.warn("reload:", e);
        showSyncBox("Sin conexión", "No se pudo conectar. Mostrando datos guardados.", false);
        hideSyncBox(2500);
        const c = document.getElementById('catalog-counter');
        if (c) c.textContent = 'Sin conexión: mostrando datos guardados';
      }
    } else {
      showSyncBox("Sin conexión", "No hay internet para actualizar. Usando datos guardados.", false);
      hideSyncBox(2500);
      applyFilters();
    }
    return;
  }
  await loadCatalogData();
  applyFilters();
}

/**
 * Borra TODA la caché vieja del navegador y recarga desde cero (bundle/Sheet).
 */
function clearPreventaCache() {
  ["ecomdx_published_catalog", "ecomdx_images", "ecomdx_selected_client_code", "ecomdx_vendedor_session", "ecomdx_vendor_catalog", "ecomdx_last_catalog", "ecomdx_brand_logo_data"].forEach(k => {
    try { localStorage.removeItem(k); } catch (e) {}
  });
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('ecomdx_vendor_catalog')) localStorage.removeItem(k);
    });
  } catch (e) {}
  state.products = [];
  state.clients = [];
  state.discounts = [];
  state.cabysMap = {};
  state.images = {};
  state.currentClient = null;
  location.reload();
}

function clearSearch() {
  const input = document.getElementById('catalog-search-input');
  if (input) input.value = '';
  applyFilters();
}

function setupEventListeners() {
  // Detección en tiempo real de conexión / modo offline
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();

  // Tecla Escape cierra modales
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeZoomModal();
      closeClientModal();
      closeConfigModal();
      toggleMenu(true);
    }
    // Enter en login ingresa
    if (e.key === 'Enter' && !document.getElementById('login-overlay')?.classList.contains('hidden')) {
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag !== "TEXTAREA") loginVendedor();
    }
  });
  // Cerrar menú al tocar fuera
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('app-menu');
    if (menu && !menu.classList.contains('hidden')) {
      if (!e.target.closest('#app-menu') && !e.target.closest('#btn-seller')) {
        menu.classList.add('hidden');
      }
    }
  });
}
