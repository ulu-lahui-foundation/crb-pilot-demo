/* Shared runtime for the CRB dashboard: data loading, filters, charts, map.
   Vanilla JS; Chart.js 4.4.1 and Leaflet 1.9.4 are loaded from cdnjs by each page. */
(function () {
  const CRB = window.CRB = {};
  const $ = (s, r = document) => r.querySelector(s);
  const el = CRB.el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === "class") n.className = v; else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  };
  CRB.fmt = (n, d = 0) => n == null ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
  CRB.compact = n => n == null ? "–" : n >= 10000 ? (n / 1000).toFixed(1) + "K" : CRB.fmt(n);
  CRB.pct = n => n == null ? "–" : CRB.fmt(n, 1) + "%";
  const HST = "Pacific/Honolulu";
  CRB.fmtTs = s => s ? new Date(s).toLocaleString("en-US", { timeZone: HST, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "–";
  CRB.fmtNight = s => new Date(s + "T12:00:00-10:00").toLocaleDateString("en-US", { timeZone: HST, month: "short", day: "numeric" });
  CRB.HOURS = [12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6,7,8,9,10,11];   // noon -> noon so night is contiguous
  CRB.hourLabel = h => h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p";
  CRB.STATUS = { confirmed: "Confirmed CRB", probable: "Probable (score ≥ τ high)", pending: "Pending review" };
  CRB.PERSIST = { under_48h: "Under 48 h", "48_to_72h": "48–72 h", over_72h: "Over 72 h" };
  CRB.T = () => {
    const cs = getComputedStyle(document.documentElement), g = k => cs.getPropertyValue(k).trim();
    return { page: g("--page"), surface: g("--surface"), surface2: g("--surface-2"), ink: g("--ink"), ink2: g("--ink-2"), muted: g("--muted"),
      grid: g("--grid"), axis: g("--axis"), accent: g("--accent"), cam: { cam1: g("--cam1"), cam2: g("--cam2"), cam3: g("--cam3") },
      status: { confirmed: g("--confirmed"), probable: g("--probable"), pending: g("--pending") }, volume: g("--volume"),
      persist: { under_48h: g("--good"), "48_to_72h": g("--warning"), over_72h: g("--critical") },
      severity: { minor: g("--warning"), moderate: g("--serious"), severe: g("--critical") },
      seq: [1,2,3,4,5,6,7].map(i => g("--seq-" + i)) };
  };
  CRB.camColor = id => CRB.T().cam[id] || CRB.T().muted;
  CRB.badge = (cls, text) => el("span", { class: "badge " + (cls === "48_to_72h" ? "b48" : cls) }, el("i"), text ?? cls);

  // ---------- theme ----------
  const themeBtn = () => {
    const b = el("button", { class: "ghost", title: "Toggle light / dark", onclick: () => {
      const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("crb-theme", next); } catch (e) {}
      rerender();
    } }, "◐");
    return b;
  };
  try { const t = localStorage.getItem("crb-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) {}
  const renderers = new Set();
  const rerender = () => renderers.forEach(f => f());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);
  CRB.onTheme = f => renderers.add(f);

  // ---------- data ----------
  const files = ["summary", "nightly", "hourly", "env", "detections"];
  const geo = ["zones", "piles", "damage"];
  CRB.ready = async fn => {
    const load = n => fetch(`data/${n}`).then(r => { if (!r.ok) throw new Error(n + " " + r.status); return r.json(); });
    const [s, n, h, e, d, z, p, dm, t, pz] = await Promise.all([
      ...files.map(f => load(f + ".json")), ...geo.map(f => load(f + ".geojson")), load("treatments.json"), load("piles_by_zone.json")]);
    const data = { summary: s, nightly: n, hourly: h, env: e, detections: d, zones: z, piles: p, damage: dm, treatments: t, pilesByZone: pz };
    data.cams = Object.fromEntries(s.cameras.map(c => [c.id, c]));
    CRB.data = data;
    shell(data);
    fn(data);
  };
  CRB.camName = id => (CRB.data?.cams[id]?.display_name || id).replace(/^Camera \d+ - /, "");
  CRB.camShort = id => "Cam " + id.replace("cam", "");

  function shell(data) {
    const s = data.summary;
    const hdr = $("header.top .row");
    if (hdr) {
      hdr.querySelector(".brand small").textContent = `${s.profile} build · data through ${CRB.fmtTs(s.generated_at)} HST`;
      hdr.append(themeBtn());
      const here = location.pathname.split("/").pop() || "index.html";
      hdr.querySelectorAll("nav a").forEach(a => { if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page"); });
    }
    const b = $("#banner");
    if (b) {
      if (s.profile === "demo") { b.textContent = `DEMONSTRATION — ${s.synthetic_detections} "confirmed" detections shown here are synthetic examples (licensed beetle photos composited onto real frames) to show how the system works. No CRB has been confirmed at Ko Olina as of ${CRB.fmtTs(s.generated_at)}. Counts of photos, wind and camera health are real.`; b.hidden = false; }
      else if (s.demo) { b.textContent = "DEMO BUILD — synthetic photos and sample inventory for design review. Not pilot data."; b.hidden = false; }
      else if (s.profile === "public") { b.textContent = "Public view: counts are aggregated by zone; imagery and parcel-level locations are withheld per the pilot data-handling agreement."; b.className = "banner public"; b.hidden = false; }
    }
  }

  // ---------- filters (one row above everything; state in URL hash) ----------
  CRB.filters = (data, onChange) => {
    const nights = data.nightly.map(n => n.night);
    const camIds = data.summary.cameras.map(c => c.id);
    const state = { cams: new Set(camIds), from: nights[0], to: nights[nights.length - 1], preset: "all" };
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("cams")) state.cams = new Set(h.get("cams").split(",").filter(c => camIds.includes(c)));
    if (h.get("from") && nights.includes(h.get("from"))) state.from = h.get("from");
    if (h.get("to") && nights.includes(h.get("to"))) state.to = h.get("to");
    if (h.get("preset")) state.preset = h.get("preset");
    const applyPreset = p => { state.preset = p; if (p === "all") { state.from = nights[0]; state.to = nights.at(-1); }
      else { const k = +p; state.to = nights.at(-1); state.from = nights[Math.max(0, nights.length - k)]; } };
    if (state.preset !== "all" && state.preset !== "custom") applyPreset(state.preset);
    const box = $("#filters"); if (!box) return state;
    const render = () => {
      box.replaceChildren();
      const presets = el("div", { class: "group", role: "group", "aria-label": "Night range" }, el("span", { class: "muted" }, "Nights"));
      for (const [p, lab] of [["all", "All"], ["7", "Last 7"], ["3", "Last 3"]])
        presets.append(el("button", { class: "preset", "aria-pressed": String(state.preset === p), onclick: () => { applyPreset(p); commit(); } }, lab));
      const sel = (key) => { const s = el("select", { onchange: e => { state[key] = e.target.value; state.preset = "custom"; commit(); } });
        nights.forEach(n => s.append(el("option", { value: n, selected: state[key] === n ? "" : null }, CRB.fmtNight(n)))); return s; };
      presets.append(sel("from"), el("span", { class: "muted" }, "to"), sel("to"));
      const cams = el("div", { class: "group", "aria-label": "Cameras" }, el("span", { class: "muted" }, "Cameras"));
      for (const c of camIds) cams.append(el("label", { class: "chip" },
        el("input", { type: "checkbox", checked: state.cams.has(c) ? "" : null, onchange: e => { e.target.checked ? state.cams.add(c) : state.cams.delete(c); commit(); } }),
        el("i", { class: "sw", style: `background:${CRB.camColor(c)}` }), CRB.camShort(c)));
      box.append(presets, cams);
    };
    const commit = () => {
      if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
      location.hash = new URLSearchParams({ preset: state.preset, from: state.from, to: state.to, cams: [...state.cams].join(",") }).toString();
      render(); onChange(state);
    };
    render(); onChange(state);
    return state;
  };
  CRB.inRange = (state, night) => night >= state.from && night <= state.to;

  // Derived slices used by every card so numbers always agree.
  CRB.select = (data, st) => {
    const cams = [...st.cams];
    const nightly = data.nightly.filter(n => CRB.inRange(st, n.night)).map(n => {
      const agg = { night: n.night, photos: 0, confirmed: 0, probable: 0, pending: 0, wind_mph_mean: n.wind_mph_mean, per_camera: {} };
      for (const c of cams) { const v = n.per_camera[c] || {}; agg.per_camera[c] = v;
        for (const k of ["photos", "confirmed", "probable", "pending"]) agg[k] += v[k] || 0; }
      return agg;
    });
    const hourly = { photos: Array(24).fill(0), confirmed: Array(24).fill(0), perCam: {} };
    for (const c of cams) {
      const pc = data.hourly.per_camera[c]; if (!pc) continue;
      const mine = { photos: Array(24).fill(0), confirmed: Array(24).fill(0), nights: [] };
      for (const nt of pc.nights) if (CRB.inRange(st, nt.night)) { mine.nights.push(nt);
        for (let h = 0; h < 24; h++) { mine.photos[h] += nt.photos[h]; mine.confirmed[h] += nt.confirmed[h]; hourly.photos[h] += nt.photos[h]; hourly.confirmed[h] += nt.confirmed[h]; } }
      hourly.perCam[c] = mine;
    }
    const detections = data.detections.filter(d => st.cams.has(d.camera_id) && CRB.inRange(st, d.night));
    const totals = nightly.reduce((a, n) => { for (const k of ["photos", "confirmed", "probable", "pending"]) a[k] += n[k]; return a; }, { photos: 0, confirmed: 0, probable: 0, pending: 0 });
    totals.flagged = totals.confirmed + totals.probable + totals.pending;
    return { nightly, hourly, detections, totals, cams };
  };

  // ---------- chart card ----------
  // cfg: {labels, datasets:[{label,color,data,type,stack,yAxisID}], stacked, yTitle, xTitle, table:{cols, rows}, note, direct?}
  CRB.chart = (host, cfg) => {
    host.replaceChildren();
    const plot = el("div", { class: "plot" + (cfg.tall ? " tall" : "") }, el("canvas", { role: "img", "aria-label": cfg.aria || cfg.title || "chart" }));
    const twrap = el("div", { class: "tablewrap", hidden: "" });
    const legend = el("div", { class: "legend" });
    const tools = host.closest(".card")?.querySelector(".tools");
    if (tools) {
      tools.replaceChildren();
      const tb = el("button", { "aria-pressed": "false", onclick: () => { const on = tb.getAttribute("aria-pressed") !== "true"; tb.setAttribute("aria-pressed", String(on)); twrap.hidden = !on; plot.hidden = on; } }, "Table");
      const dl = el("button", { onclick: () => downloadCsv((cfg.title || "chart") + ".csv", cfg.table) }, "CSV");
      tools.append(tb, dl);
    }
    host.append(plot, twrap, legend);
    let chart;
    const draw = () => {
      const T = CRB.T();
      Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
      Chart.defaults.font.size = 11; Chart.defaults.color = T.muted;
      chart?.destroy();
      const ds = cfg.datasets.map(d => {
        const isLine = (d.type || cfg.type) === "line";
        return { label: d.label, data: d.data, type: d.type, stack: d.stack, yAxisID: d.yAxisID, order: d.order,
          backgroundColor: isLine ? d.color + "1a" : d.color, borderColor: isLine ? d.color : T.surface,
          borderWidth: isLine ? 2 : (cfg.stacked ? (cfg.horizontal ? { right: 2, top: 0, bottom: 0, left: 0 } : { top: 2, left: 0, right: 0, bottom: 0 }) : 0),
          borderSkipped: cfg.stacked ? false : (cfg.horizontal ? "left" : "bottom"), borderRadius: cfg.stacked ? 0 : 4, maxBarThickness: 24,
          pointRadius: isLine ? (cfg.labels.length > 40 ? 0 : 4) : 0, pointHoverRadius: 6, pointBackgroundColor: d.color, pointBorderColor: T.surface, pointBorderWidth: 2,
          tension: 0, fill: !!d.fill, spanGaps: true };
      });
      chart = new Chart(plot.querySelector("canvas"), {
        type: cfg.type || "bar", data: { labels: cfg.labels, datasets: ds },
        options: { indexAxis: cfg.horizontal ? "y" : "x", responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: false }, tooltip: { backgroundColor: T.surface, titleColor: T.ink, bodyColor: T.ink2, borderColor: T.grid, borderWidth: 1, padding: 10,
            usePointStyle: true, boxWidth: 8, boxHeight: 8, callbacks: { label: c => ` ${CRB.fmt(cfg.horizontal ? c.parsed.x : c.parsed.y, 1)}  ${c.dataset.label}` } } },
          scales: cfg.horizontal
            ? { y: { stacked: !!cfg.stacked, grid: { display: false }, border: { color: T.axis }, ticks: { color: T.ink2, autoSkip: false, callback: function (v) { const l = this.getLabelForValue(v); return l.length > 26 ? l.slice(0, 25) + "…" : l; } } },
                x: { stacked: !!cfg.stacked, beginAtZero: true, grid: { color: T.grid, lineWidth: 1 }, border: { display: false }, ticks: { color: T.muted, precision: 0, callback: v => CRB.compact(v) }, title: { display: !!cfg.yTitle, text: cfg.yTitle, color: T.muted } } }
            : { x: { stacked: !!cfg.stacked, grid: { display: false }, border: { color: T.axis }, ticks: { maxRotation: 0, autoSkip: true, color: T.muted }, title: { display: !!cfg.xTitle, text: cfg.xTitle, color: T.muted } },
                y: { stacked: !!cfg.stacked, beginAtZero: true, grid: { color: T.grid, lineWidth: 1 }, border: { display: false }, ticks: { color: T.muted, precision: 0, callback: v => CRB.compact(v) }, title: { display: !!cfg.yTitle, text: cfg.yTitle, color: T.muted } } } }
      });
      legend.replaceChildren();
      if (cfg.datasets.length >= 2) for (const d of cfg.datasets) legend.append(el("span", { class: "key" }, el("i", { class: (d.type || cfg.type) === "line" ? "line" : "", style: `background:${d.color}` }), d.label));
      if (cfg.note) legend.append(el("span", { class: "muted" }, cfg.note));
    };
    draw(); CRB.onTheme(draw);
    if (cfg.table) twrap.append(CRB.table(cfg.table.cols, cfg.table.rows));
    return { update: c => { Object.assign(cfg, c); draw(); if (cfg.table) twrap.replaceChildren(CRB.table(cfg.table.cols, cfg.table.rows)); } };
  };
  // cols: [{key,label,num,render}] rows: objects
  CRB.table = (cols, rows) => {
    const t = el("table", { class: "data" }, el("thead", {}, el("tr", {}, ...cols.map(c => el("th", { class: c.num ? "num" : null }, c.label)))));
    const tb = el("tbody"); t.append(tb);
    if (!rows.length) tb.append(el("tr", {}, el("td", { colspan: cols.length, class: "empty" }, "No rows")));
    for (const r of rows) tb.append(el("tr", {}, ...cols.map(c => el("td", { class: c.num ? "num" : null }, c.render ? c.render(r[c.key], r) : (c.num ? CRB.fmt(r[c.key], c.d ?? 0) : (r[c.key] ?? "–"))))));
    return t;
  };
  const downloadCsv = (name, table) => {
    if (!table) return;
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [table.cols.map(c => esc(c.label)).join(","), ...table.rows.map(r => table.cols.map(c => esc(r[c.key])).join(","))].join("\n");
    const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: name }); a.click(); URL.revokeObjectURL(a.href);
  };
  CRB.downloadCsv = downloadCsv;

  // ---------- stat tile ----------
  CRB.tile = (label, value, opts = {}) => {
    const t = el("div", { class: "card tile" }, el("div", { class: "label" }, label), el("div", { class: "value" + (opts.hero ? " hero" : "") }, value));
    if (opts.delta) t.append(el("div", { class: "delta " + (opts.deltaClass || "") }, opts.delta));
    if (opts.meter != null) { const m = el("div", { class: "meter" }, el("i", { style: `width:${Math.max(0, Math.min(100, opts.meter))}%;background:${opts.meterColor || CRB.T().accent}` })); t.append(m); }
    if (opts.body) t.append(opts.body);
    return t;
  };

  // ---------- map ----------
  CRB.map = (host, data, opts = {}) => {
    const T = CRB.T(), cfg = window.CRB_CONFIG || {}, pub = data.summary.profile !== "internal";
    const map = L.map(host, { scrollWheelZoom: false, zoomControl: true }).setView(cfg.mapCenter || [21.3375, -158.1185], cfg.mapZoom || 15);
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri World Imagery" }).addTo(map);
    const base = { "Imagery": sat, "Streets": osm }, overlays = {};
    if (cfg.orthoTilesUrl) overlays["Drone orthomosaic"] = L.tileLayer(cfg.orthoTilesUrl, { maxZoom: cfg.orthoMaxZoom || 21, maxNativeZoom: cfg.orthoMaxZoom || 21 }).addTo(map);
    const catStyle = f => { const c = f.properties.category || "";
      return c.includes("Flight") ? { color: T.ink2, weight: 1, dashArray: null, fill: false }
        : c.includes("High-damage") ? { color: T.severity.severe, weight: 1.5, fillColor: T.severity.severe, fillOpacity: .08 }
        : c.includes("staging") ? { color: T.severity.minor, weight: 1.5, fillColor: T.severity.minor, fillOpacity: .12 }
        : { color: T.muted, weight: 1, fillColor: T.muted, fillOpacity: .06 }; };
    overlays["Target areas (§6)"] = L.geoJSON(data.zones, { style: catStyle, onEachFeature: (f, l) => l.bindPopup(popup(f.properties.name, [["Category", f.properties.category], ["Jurisdiction", f.properties.jurisdiction], ["Geometry", f.properties.geometry_status], pub ? null : ["Notes", f.properties.notes]])) }).addTo(map);
    // traps: marker area ∝ confirmed detections (+ floor), color fixed per camera
    const traps = L.layerGroup().addTo(map); overlays["Smart traps"] = traps;
    const stats = opts.camStats || Object.fromEntries(data.summary.cameras.map(c => [c.id, c]));
    for (const c of data.summary.cameras) {
      const s = stats[c.id] || c, r = 7 + Math.sqrt(s.confirmed || 0) * 1.6;
      L.circleMarker([c.lat, c.lon], { radius: r, color: T.surface, weight: 2, fillColor: CRB.camColor(c.id), fillOpacity: .95 })
        .bindPopup(popup(c.display_name, [["Confirmed CRB", CRB.fmt(s.confirmed)], ["Probable", CRB.fmt(s.probable)], ["Pending review", CRB.fmt(s.pending)], ["Photos", CRB.fmt(s.photos_total ?? s.photos)],
          ["Last photo", CRB.fmtTs(c.last_seen)], ["Coordinates", `${c.lat}, ${c.lon}${c.coord_status !== "confirmed" ? " (" + c.coord_status + ")" : ""}`], ["", `<a href="trap.html?id=${c.id}">Trap detail →</a>`]])).addTo(traps);
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: "cam-label", html: CRB.camShort(c.id), iconAnchor: [-12, 8] }), interactive: false }).addTo(traps);
    }
    // piles & damage
    const pileLayer = L.geoJSON(data.piles, { pointToLayer: (f, ll) => {
      const p = f.properties;
      if (data.piles.aggregated) return L.marker(ll, { icon: L.divIcon({ className: "", html: `<div class="count-label" style="width:22px;height:22px;border-radius:50%;background:${T.ink2}">${p.count}</div>`, iconSize: [22, 22] }) })
        .bindPopup(popup(p.name, [["Piles", p.count], ...Object.entries(p.by_class).map(([k, v]) => [CRB.PERSIST[k], v])]));
      return L.circleMarker(ll, { radius: 7, color: T.surface, weight: 2, fillColor: T.persist[p.persistence_class], fillOpacity: .95 })
        .bindPopup(popup("Pile " + p.id, [["Persistence", CRB.PERSIST[p.persistence_class]], ["First seen", p.first_seen], ["Last seen", p.last_seen], ["Jurisdiction", p.jurisdiction], ["Source", p.source], ["", p.description]])); } }).addTo(map);
    overlays["Green-waste piles"] = pileLayer;
    const dmgLayer = L.geoJSON(data.damage, { pointToLayer: (f, ll) => {
      const p = f.properties;
      if (data.damage.aggregated) return L.marker(ll, { icon: L.divIcon({ className: "", html: `<div class="count-label" style="width:20px;height:20px;background:${T.severity.moderate};clip-path:polygon(50% 0,100% 100%,0 100%)"></div>`, iconSize: [20, 20], iconAnchor: [10, 24] }) })
        .bindPopup(popup(p.name, [["Damage observations", p.count], ...Object.entries(p.by_severity).map(([k, v]) => [k, v])]));
      return L.marker(ll, { icon: L.divIcon({ className: "", html: `<div style="width:16px;height:16px;background:${T.severity[p.severity] || T.muted};clip-path:polygon(50% 0,100% 100%,0 100%)"></div>`, iconSize: [16, 16], iconAnchor: [8, 16] }) })
        .bindPopup(popup("Damage " + p.id, [["Severity", p.severity], ["Observed", p.observed_on], ["Phase", p.phase], ["Source", p.source], ["", p.description]])); } }).addTo(map);
    overlays["Crown damage"] = dmgLayer;
    L.control.layers(base, overlays, { collapsed: true, position: "topright" }).addTo(map);
    const pts = data.summary.cameras.map(c => [c.lat, c.lon]);
    data.zones.features.forEach(f => { if (!(f.properties.category || "").includes("Flight")) f.geometry.coordinates[0].forEach(([x, y]) => pts.push([y, x])); });
    if (pts.length) { const b = L.latLngBounds(pts); map.fitBounds(b, { padding: [24, 24], maxZoom: 16 });
      for (const ms of [50, 400, 1200]) setTimeout(() => { map.invalidateSize(); map.fitBounds(b, { padding: [24, 24], maxZoom: 16 }); }, ms); }
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    const leg = host.parentElement.querySelector(".map-legend");
    if (leg) { leg.replaceChildren();
      for (const c of data.summary.cameras) leg.append(el("span", { class: "key" }, el("i", { style: `background:${CRB.camColor(c.id)};border-radius:50%` }), CRB.camShort(c.id) + " · " + CRB.camName(c.id)));
      leg.append(el("span", { class: "key" }, el("i", { style: `background:${T.severity.severe};clip-path:polygon(50% 0,100% 100%,0 100%)` }), "Crown damage"));
      if (!data.piles.aggregated) for (const k of Object.keys(CRB.PERSIST)) leg.append(el("span", { class: "key" }, el("i", { style: `background:${T.persist[k]};border-radius:50%` }), "Pile " + CRB.PERSIST[k]));
      else leg.append(el("span", { class: "key" }, el("i", { style: `background:${T.ink2};border-radius:50%` }), "Piles per zone"));
      leg.append(el("span", { class: "muted" }, "Trap marker area scales with confirmed detections."));
    }
    return map;
  };
  const popup = (title, rows) => `<b>${esc(title)}</b>` + rows.filter(Boolean).map(([k, v]) => v == null ? "" : `<div>${k ? `<span style="color:#898781">${esc(k)}:</span> ` : ""}${k === "" ? v : esc(String(v))}</div>`).join("");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- heatmap (night × hour), sequential single hue ----------
  CRB.heatmap = (host, nights, opts = {}) => {
    const T = CRB.T(), key = opts.key || "photos";
    const max = Math.max(1, ...nights.flatMap(n => n[key]));
    const step = v => v === 0 ? T.surface2 : T.seq[Math.min(6, Math.floor((v / max) * 6.999))];
    host.replaceChildren();
    const g = el("div", { class: "heat", role: "table" });
    g.append(el("div")); for (const h of CRB.HOURS) g.append(el("div", { class: "cl" }, h % 3 === 0 ? CRB.hourLabel(h) : ""));
    for (const n of nights) { g.append(el("div", { class: "rl" }, CRB.fmtNight(n.night)));
      for (const h of CRB.HOURS) g.append(el("div", { class: "c", title: `${CRB.fmtNight(n.night)} ${CRB.hourLabel(h)}: ${CRB.fmt(n[key][h])} ${key}`, style: `background:${step(n[key][h])}` })); }
    const sc = el("div", { class: "heat-scale" }, "0", ...T.seq.map(c => el("i", { style: `background:${c}` })), CRB.fmt(max) + " " + key + " / hour");
    host.append(g, sc);
  };

  // ---------- detections table ----------
  CRB.detectionsTable = (host, dets, opts = {}) => {
    const pub = CRB.data.summary.profile === "public";
    const demo = CRB.data.summary.profile === "demo";
    let n = opts.limit || 50;
    const cols = [
      ...(pub ? [] : [{ key: "thumb", label: "Frame", render: (v, r) => v ? el("a", { href: v, target: "_blank" }, el("img", { class: "thumb", src: v, alt: "flagged frame", loading: "lazy" })) : el("div", { class: "thumb ph" }, "no image") }]),
      { key: "ts", label: "Time (HST)", render: v => CRB.fmtTs(v) },
      { key: "camera_id", label: "Camera", render: v => el("span", { class: "key" }, el("i", { class: "sw", style: `display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${CRB.camColor(v)}` }), CRB.camName(v)) },
      { key: "status", label: "Status", render: (v, r) => r.synthetic ? el("span", {}, CRB.badge(v, CRB.STATUS[v]), " ", el("span", { class: "badge synthetic" }, "synthetic example")) : CRB.badge(v, CRB.STATUS[v]) },
      { key: "score", label: "Score", num: true, d: 2 },
      { key: "label", label: "Human label", render: v => v || el("span", { class: "muted" }, "—") }];
    const render = () => { host.replaceChildren(el("div", { class: "tablewrap" }, CRB.table(cols, dets.slice(0, n))));
      if (dets.length > n) host.append(el("button", { class: "ghost", style: "margin-top:8px", onclick: () => { n += 100; render(); } }, `Show more (${CRB.fmt(dets.length - n)} more)`)); };
    render();
  };
})();
