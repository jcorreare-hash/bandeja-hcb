/* Bandeja HCB v3: casos de WhatsApp laboral leídos de la hoja de Google a través del puente de Apps Script.
   La app nunca envía mensajes por sí sola: abre WhatsApp con el texto aprobado y la persona lo envía,
   o deja el caso aprobado para que Claude lo envíe cuando Jorge lo pida. */
(() => {
  "use strict";

  const VERSION = "3.0";
  const TZ = "America/Bogota";
  const K = { cfg: "bandejaHCB.cfg", cache: "bandejaHCB.cache", outbox: "bandejaHCB.outbox", envio: "bandejaHCB.envio", install: "bandejaHCB.install", vista: "bandejaHCB.vista", plegadas: "bandejaHCB.plegadas" };
  const CATS = [
    ["", "Todas"], ["SST (accidente o salud)", "SST"], ["Alimentación", "Alimentación"], ["Permiso o incapacidad", "Permisos"],
    ["Pregunta", "Preguntas"], ["Documento o RAM", "Documentos"], ["Emergencia", "Emergencias"], ["Sindical", "Sindical"], ["Informativo", "Informativo"],
  ];
  const CORTO = Object.fromEntries(CATS.filter(([v]) => v).map(([v, l]) => [v, l]));
  const CAT_CLASE = { "SST (accidente o salud)": "c-sst", "Alimentación": "c-ali", "Permiso o incapacidad": "c-per", "Pregunta": "c-pre", "Documento o RAM": "c-doc", "Emergencia": "c-eme", "Sindical": "c-sin", "Informativo": "c-inf" };
  const PRIO = { Urgente: 0, Alta: 1, Normal: 2 };
  const CERRADOS = ["Enviado", "Resuelto", "Descartado"];
  const LIMITE_ESPERA_H = { Urgente: 1, Alta: 4, Normal: 24 };
  const MOVIL = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const IC = {
    wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/></svg>',
    lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    reloj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pasar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 11h6"/><path d="m20 8 3 3-3 3"/></svg>',
    basura: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    volver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    campana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    atras: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    arriba: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    abajo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    tel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    ficha: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 9h3"/><path d="M15 13h3"/><path d="M6 16c.6-1.5 1.7-2 3-2s2.4.5 3 2"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>',
    grupo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 4a3 3 0 0 1 0 6"/><path d="M21 20c0-2-1-3.5-3-4.3"/></svg>',
    tarea: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    hoja: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 40c4-16 14-28 32-32-2 18-14 28-30 30"/><path d="M8 40 26 22"/></svg>',
  };

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const state = {
    vista: store.get(K.vista) || "bandeja", tab: "pend", cat: "", buscar: "", buscarP: "", periodo: "mes", persona: null,
    cases: new Map(), estado: {}, plantillas: [], equipo: [], fichas: [],
    drafts: new Map(), lastSync: null, syncing: false, offline: false, pendingRender: false, installEvt: null,
    detalle: null, orden: [], sel: null, plegadas: new Set(store.get(K.plegadas) || []), hiloCompleto: new Set(),
  };
  let cfg = store.get(K.cfg);
  let outbox = (store.get(K.outbox) || []).map((o) => (o.k ? o : { k: "caso", id: o.id, cambios: o.cambios, t: o.t }));

  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid) n.append(kid);
    return n;
  };
  const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const norm = (s) => str(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} };
  const now = () => Date.now();
  const t = (iso) => { const d = Date.parse(iso); return isNaN(d) ? 0 : d; };
  function conIcono(cls, icon, texto, onclick, extra = {}) {
    const b = el("button", { type: "button", class: cls, html: icon, onclick, ...extra });
    b.append(el("span", { text: texto }));
    return b;
  }

  // ---------- fechas (hora de Bogotá) ----------
  const fmtTime0 = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const fmtTime = (d) => fmtTime0.format(d).replace(/\s/g, " ");
  const fmtDate = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const fmtCorta = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "numeric", month: "short" });
  const fmtLarga = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  function partes(d) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
    const g = (k) => (p.find((x) => x.type === k) || {}).value;
    return { y: +g("year"), m: +g("month"), d: +g("day"), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), h: +g("hour"), mi: +g("minute") };
  }
  const pad = (n) => String(n).padStart(2, "0");
  function isoBogota(y, m, d, h, mi) { const u = new Date(Date.UTC(y, m - 1, d)); return u.getUTCFullYear() + "-" + pad(u.getUTCMonth() + 1) + "-" + pad(u.getUTCDate()) + "T" + pad(h) + ":" + pad(mi) + ":00-05:00"; }
  function diaHabil(diasMas) { // próximo día (sumando días) a las 8:00, saltando sábado y domingo
    const p = partes(new Date());
    let u = new Date(Date.UTC(p.y, p.m - 1, p.d + diasMas));
    while (u.getUTCDay() === 0 || u.getUTCDay() === 6) u = new Date(u.getTime() + 86400000);
    return isoBogota(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), 8, 0);
  }
  function when(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return str(iso);
    const n = new Date();
    if (dayKey(d) === dayKey(n)) return "Hoy " + fmtTime(d);
    if (dayKey(d) === dayKey(new Date(n.getTime() - 86400000))) return "Ayer " + fmtTime(d);
    if (dayKey(d) === dayKey(new Date(n.getTime() + 86400000))) return "Mañana " + fmtTime(d);
    return fmtDate.format(d) + " " + fmtTime(d);
  }
  function hace(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return min + " min";
    const h = Math.round(min / 60);
    if (h < 48) return h + " h";
    return Math.round(h / 24) + " d";
  }
  function deadline(c) {
    const p = str(c.plazo_sst);
    if (!p) return null;
    const d = new Date(p + "T12:00:00-05:00");
    const label = isNaN(d) ? p : fmtCorta.format(d);
    const hoy = dayKey(new Date());
    if (CERRADOS.includes(c.estado)) return { texto: "Plazo ARL " + label, clase: "" };
    if (p < hoy) return { texto: "Plazo ARL vencido", clase: "red" };
    if (p === hoy) return { texto: "Plazo ARL hoy", clase: "red" };
    return { texto: "Plazo ARL " + label, clase: "yel" };
  }
  const ultimoDe = (c) => c.ultimo_mensaje || c.recibido;
  function edad(c) {
    const desde = t(ultimoDe(c));
    if (!desde) return { texto: "", clase: "" };
    const ms = now() - desde;
    if (CERRADOS.includes(c.estado)) return { texto: fmtCorta.format(new Date(desde)), clase: "" };
    const lim = (LIMITE_ESPERA_H[c.prioridad] || 24) * 3600000;
    return { texto: hace(ms), clase: ms > lim ? "late" : ms > lim / 2 ? "warn" : "" };
  }
  const pospuesto = (c) => c.estado === "Pendiente" && t(c.pospuesto) > now();
  const recordatorio = (c) => c.estado === "Pendiente" && c.pospuesto && t(c.pospuesto) <= now();
  const segVencido = (c) => c.seguimiento && t(c.seguimiento) <= now() && c.estado !== "Descartado";
  const segFuturo = (c) => c.seguimiento && t(c.seguimiento) > now() && c.estado !== "Descartado";

  // ---------- personas, municipios y avatares ----------
  function claseMunicipio(m) {
    const n = norm(m);
    if (n.includes("necocli")) return "--m-necocli";
    if (n.includes("chigorodo")) return "--m-chigorodo";
    if (n.includes("apartado")) return "--m-apartado";
    if (n.includes("vigia")) return "--m-vigia";
    if (n.includes("murindo")) return "--m-murindo";
    return "--m-otro";
  }
  function iniciales(nombre) {
    const p = str(nombre).replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return ((p[0][0] || "") + (p.length > 1 ? p[1][0] : "")).toUpperCase();
  }
  const esGrupo = (c) => !!c.chat && !!c.persona && norm(c.chat) !== norm(c.persona) && /hcb|fupet|grupo|equipo|varios/i.test(str(c.chat));
  function avatar(nombre, municipio, grupo) {
    const a = el("span", { class: "avatar", "aria-hidden": "true", text: iniciales(nombre) });
    a.style.background = "var(" + claseMunicipio(municipio) + ")";
    if (grupo) a.append(el("span", { class: "grp", html: IC.grupo }));
    return a;
  }
  function primerNombre(c) {
    const p = str(c.persona || c.destinatario).trim().split(/\s+/)[0] || "";
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
  }
  const lugar = (c) => [c.hogar ? (/^(hcb|hogar)/i.test(c.hogar) ? c.hogar : "Hogar " + c.hogar) : "", c.municipio].filter(Boolean).join(", ");

  // ---------- conversación y documentos dentro del mensaje ----------
  const RX_LINEA = /^\[(\d{1,2}\/\d{1,2})(?:\/\d{2,4})?,?\s+(\d{1,2}:\d{2}(?:\s*[ap]\.?\s?m\.?)?)\]\s*([^:\]\(]{1,70}?(?:\s*\([^)]*\))?)\s*:\s?([\s\S]*)$/i;
  function parseDocs(c) {
    const docs = [];
    str(c.mensaje).split("\n").forEach((ln) => {
      const s = ln.trim();
      if (!s.startsWith("📎")) return;
      const partesDoc = s.replace(/^📎\s*/, "").split(/\s*\|\s*/);
      const d = { tipo: partesDoc.shift() || "Documento" };
      partesDoc.forEach((p) => { const m = p.match(/^([^:]{2,20}):\s*(.*)$/); if (m) d[norm(m[1])] = m[2].trim(); });
      docs.push({ tipo: d.tipo, desde: d.desde || "", hasta: d.hasta || "", dias: d.dias || "", dx: d.diagnostico || "", archivo: d.archivo || "" });
    });
    if (!docs.length && (c.documento || c.desde || c.hasta)) docs.push({ tipo: str(c.documento) || "Documento", desde: str(c.desde), hasta: str(c.hasta), dias: str(c.dias), dx: str(c.diagnostico), archivo: "" });
    return docs;
  }
  function parseHilo(c) {
    const lineas = str(c.mensaje).split("\n");
    const out = [];
    let ok = 0;
    for (const ln of lineas) {
      const s = ln.trim();
      if (!s || s.startsWith("📎")) continue;
      const m = s.match(RX_LINEA);
      if (m) {
        ok++;
        const autor = m[3].trim();
        const audio = /\(audio/i.test(autor);
        out.push({ fecha: m[1], hora: m[2], autor: autor.replace(/\s*\(.*$/, ""), texto: m[4], yo: /^t[uú]$/i.test(autor.replace(/\s*\(.*$/, "")), audio });
      } else if (out.length) out[out.length - 1].texto += "\n" + s;
      else out.push({ texto: s });
    }
    return ok ? out : null;
  }
  const fechaCorta = (s) => { const m = str(s).match(/^(\d{1,2})\/(\d{1,2})/); if (!m) return str(s); const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]; return +m[1] + " " + (meses[+m[2] - 1] || m[2]); };

  // ---------- WhatsApp ----------
  function normTel(x) {
    let d = str(x).replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 10 && d.startsWith("3")) d = "57" + d;
    return d.length >= 11 ? d : "";
  }
  function waUrl(tel, texto) {
    const n = normTel(tel), q = texto ? "&text=" + encodeURIComponent(texto) : "";
    if (MOVIL) return n ? "whatsapp://send?phone=" + n + q : "whatsapp://send?" + q.slice(1);
    return n ? "https://web.whatsapp.com/send?phone=" + n + q : "https://web.whatsapp.com/send?" + q.slice(1);
  }
  function abrirUrl(url) {
    if (window.__abrirUrl) window.__abrirUrl(url);
    else if (MOVIL) window.location.href = url;
    else window.open(url, "_blank", "noopener");
  }
  function copiar(texto) { try { navigator.clipboard && navigator.clipboard.writeText(texto).catch(() => {}); } catch (e) {} }
  function abrirWhatsApp(id, env) {
    if (!normTel(env.telefono)) copiar(env.texto);
    store.set(K.envio, { id, key: env.key, t: now() });
    abrirUrl(waUrl(env.telefono, env.texto));
    clearTimeout(abrirWhatsApp.t);
    abrirWhatsApp.t = setTimeout(() => { if (document.visibilityState === "visible") revisarEnvio(); }, 4500);
  }
  function enviosDe(c) {
    const out = [];
    if (c.destinatario && str(c.respuesta).trim()) out.push({ key: "r", para: c.destinatario, telefono: c.telefono, texto: c.respuesta, enviado: !!c.respuesta_enviada });
    (Array.isArray(c.reenvios) ? c.reenvios : []).forEach((r, i) => {
      if (r && r.enviar && str(r.texto).trim()) out.push({ key: "f" + i, para: str(r.para), telefono: str(r.telefono), texto: str(r.texto), enviado: !!r.enviado });
    });
    return out;
  }

  // ---------- plantillas ----------
  function rellenar(texto, c) {
    const vals = { nombre: primerNombre(c), hogar: str(c.hogar), municipio: str(c.municipio), persona: str(c.persona), tema: temaDe(c) };
    return str(texto).replace(/\{(\w+)\}/g, (m, k) => (vals[k.toLowerCase()] ? vals[k.toLowerCase()] : "[" + k + "]"));
  }
  function temaDe(c) {
    const m = { "SST (accidente o salud)": "todo con su salud", "Alimentación": "lo de los alimentos", "Permiso o incapacidad": "lo del permiso", "Documento o RAM": "lo de los documentos", "Emergencia": "la situación en el hogar" };
    return m[str(c && c.categoria)] || "lo que hablamos";
  }
  function plantillasPara(c) {
    const cat = str(c && c.categoria);
    return [...state.plantillas].sort((a, b) => (b.categoria === cat) - (a.categoria === cat));
  }

  // ---------- datos locales ----------
  function applyCambios(c, cambios) {
    const n = { ...c };
    if (cambios.estado !== undefined) {
      n.estado = cambios.estado;
      if (cambios.estado === "Pendiente") { n.enviado = ""; n.aprobado = ""; n.respuesta_enviada = false; }
      if (cambios.estado === "Enviado" && !n.enviado) n.enviado = new Date().toISOString();
    }
    for (const k of ["respuesta", "nota", "reenvios", "pospuesto", "seguimiento", "asignado"]) if (cambios[k] !== undefined) n[k] = cambios[k];
    if (cambios.respuesta_enviada !== undefined) n.respuesta_enviada = !!cambios.respuesta_enviada;
    if (cambios.aprobado) n.aprobado = new Date().toISOString();
    n.actualizado = new Date().toISOString();
    return n;
  }
  function persistCache() { store.set(K.cache, { casos: [...state.cases.values()], estado: state.estado, plantillas: state.plantillas, equipo: state.equipo, fichas: state.fichas, t: state.lastSync }); }

  // ---------- puente ----------
  async function api(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, clave: cfg.clave }), signal: ctrl.signal, redirect: "follow" });
      if (!r.ok) throw new Error("http " + r.status);
      const j = await r.json();
      if (!j.ok) { const e = new Error(j.error || "error"); e.code = j.error; throw e; }
      return j;
    } finally { clearTimeout(timer); }
  }
  function encolar(op) {
    outbox.push({ ...op, t: now() });
    store.set(K.outbox, outbox);
    persistCache();
    renderSafe();
    procesarOutbox();
  }
  function queue(id, cambios) {
    const c = state.cases.get(id);
    if (c) state.cases.set(id, applyCambios(c, cambios));
    encolar({ k: "caso", id, cambios });
  }
  const MOTIVO = { no_existe: "ese caso ya no está en la hoja", estado: "la hoja no aceptó ese estado", id: "el caso no tiene ID", falta_nombre: "falta el nombre", accion: "el puente no reconoce la acción" };
  let procesando = false;
  async function procesarOutbox() {
    if (procesando || !cfg) return;
    procesando = true;
    try {
      while (outbox.length) {
        const op = outbox[0];
        try {
          if (op.k === "plantilla") await api({ accion: "guardarPlantilla", ...op.datos });
          else if (op.k === "ficha") await api({ accion: "guardarFicha", ...op.datos });
          else {
            const j = await api({ accion: "actualizar", id: op.id, cambios: op.cambios });
            let caso = j.caso;
            if (caso && caso.id === op.id) {
              for (const later of outbox.slice(1)) if (later.k === "caso" && later.id === op.id) caso = applyCambios(caso, later.cambios);
              state.cases.set(op.id, caso);
            }
          }
          outbox.shift(); store.set(K.outbox, outbox); persistCache();
        } catch (e) {
          if (MOTIVO[e.code]) {
            outbox.shift(); store.set(K.outbox, outbox);
            const c = state.cases.get(op.id);
            toast("No se guardó un cambio" + (c ? " de " + (c.persona || c.chat) : "") + ": " + MOTIVO[e.code] + ".");
            continue;
          }
          if (e.code === "clave") { mostrarConfig("La clave dejó de funcionar. Revísala."); break; }
          state.offline = true;
          break;
        }
      }
    } finally { procesando = false; renderSafe(); }
  }

  async function sync(manual) {
    if (!cfg || state.syncing) return;
    state.syncing = true; setSpin(true);
    try {
      await procesarOutbox();
      const j = await api({ accion: "listar" });
      const casos = Array.isArray(j.casos) ? j.casos : [];
      state.cases = new Map(casos.map((c) => [c.id, c]));
      for (const op of outbox) if (op.k === "caso") { const c = state.cases.get(op.id); if (c) state.cases.set(op.id, applyCambios(c, op.cambios)); }
      state.estado = j.estado || {};
      if (Array.isArray(j.plantillas)) state.plantillas = j.plantillas;
      if (Array.isArray(j.equipo)) state.equipo = j.equipo;
      if (Array.isArray(j.fichas)) state.fichas = j.fichas;
      for (const op of outbox) aplicarLocal(op);
      state.lastSync = now(); state.offline = false;
      persistCache();
      if (manual) toast("Actualizado");
    } catch (e) {
      if (e.code === "clave") { mostrarConfig("La clave no es correcta. Revísala."); return; }
      state.offline = true;
      if (manual) toast("No se pudo actualizar. Revisa la conexión.");
    } finally { state.syncing = false; setSpin(false); renderSafe(); }
  }
  function aplicarLocal(op) {
    if (op.k === "plantilla") {
      const i = state.plantillas.findIndex((p) => norm(p.nombre) === norm(op.datos.nombre));
      const p = { nombre: op.datos.nombre, texto: op.datos.texto, categoria: op.datos.categoria || "" };
      if (i >= 0) state.plantillas[i] = p; else state.plantillas.push(p);
    } else if (op.k === "ficha") {
      const i = state.fichas.findIndex((f) => norm(f.persona) === norm(op.datos.persona));
      if (i >= 0) state.fichas[i] = { ...state.fichas[i], ...op.datos }; else state.fichas.push({ ...op.datos });
    }
  }
  function setSpin(on) { $("btn-refresh").classList.toggle("spin", !!on); }

  // ---------- hojas emergentes ----------
  function abrirHoja(...kids) {
    const root = $("sheet-root");
    const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) cerrarHoja(); } }, el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, ...kids));
    root.replaceChildren(bg);
    const f = root.querySelector("textarea, input, button"); if (f) f.focus();
  }
  function cerrarHoja() { $("sheet-root").replaceChildren(); }
  let toastTimer;
  function toast(msg, undo) {
    const tt = $("toast");
    tt.replaceChildren(el("span", { text: msg }));
    if (undo) tt.append(el("button", { type: "button", text: "Deshacer", onclick: () => { tt.hidden = true; undo(); } }));
    tt.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (tt.hidden = true), undo ? 5000 : 2800);
  }
  function elegirMomento(titulo, ayuda, alElegir) {
    const p = partes(new Date());
    const opciones = [
      ["En 3 horas", new Date(now() + 3 * 3600000).toISOString()],
      ["Mañana a las 8:00 a. m.", diaHabil(1)],
      ["En 2 días, 8:00 a. m.", diaHabil(2)],
      ["En una semana", diaHabil(7)],
    ];
    if (p.wd === 5) opciones[1][0] = "El lunes a las 8:00 a. m.";
    const inp = el("input", { type: "datetime-local", "aria-label": "Fecha y hora" });
    abrirHoja(
      el("h2", { text: titulo }), ayuda ? el("p", { text: ayuda }) : null,
      el("div", { class: "btns" }, ...opciones.map(([l, iso]) => el("button", { type: "button", class: "btn", text: l, onclick: () => { cerrarHoja(); alElegir(iso); } }))),
      el("p", { text: "O elige fecha y hora:" }), inp,
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn primary", text: "Usar esa fecha", onclick: () => { if (!inp.value) { toast("Elige una fecha."); return; } cerrarHoja(); alElegir(inp.value + ":00-05:00"); } }),
        el("button", { type: "button", class: "btn quiet", text: "Cancelar", onclick: cerrarHoja })),
    );
  }

  // ---------- listas ordenadas ----------
  const coincide = (c, q) => !q || norm([c.persona, c.chat, c.hogar, c.municipio, c.resumen, c.destinatario, c.categoria].join(" ")).includes(norm(q));
  const enTab = (c, tab) => tab === "pend" ? (c.estado === "Pendiente" && !pospuesto(c)) : tab === "ready" ? c.estado === "Aprobado" : CERRADOS.includes(c.estado);
  const ordenPend = (a, b) => (recordatorio(b) - recordatorio(a)) || (PRIO[a.prioridad] ?? 2) - (PRIO[b.prioridad] ?? 2) || t(ultimoDe(a)) - t(ultimoDe(b));
  function seccionesPend(pool) {
    const urg = [], resp = [], rev = [];
    pool.forEach((c) => (c.prioridad === "Urgente" ? urg : c.destinatario ? resp : rev).push(c));
    return [
      { key: "urg", titulo: "Urgente", color: "var(--hibiscus)", casos: urg.sort(ordenPend) },
      { key: "resp", titulo: "Para responder", color: "var(--mangrove)", casos: resp.sort(ordenPend) },
      { key: "rev", titulo: "Para revisar", color: "var(--gulf)", casos: rev.sort(ordenPend) },
    ];
  }
  function casosDeTab(tab) {
    const all = [...state.cases.values()];
    const pool = all.filter((c) => enTab(c, tab)).filter((c) => coincide(c, state.buscar)).filter((c) => !state.cat || c.categoria === state.cat);
    if (tab === "pend") return seccionesPend(pool).flatMap((s) => s.casos);
    if (tab === "ready") return pool.sort((a, b) => t(a.aprobado || a.actualizado) - t(b.aprobado || b.actualizado));
    return pool.sort((a, b) => t(b.actualizado || b.recibido) - t(a.actualizado || a.recibido)).slice(0, 80);
  }

  // ---------- acciones sobre casos ----------
  function draftFor(c) {
    if (!state.drafts.has(c.id)) {
      const opts = Array.isArray(c.opciones) ? c.opciones.map(str) : [];
      const fwd = (Array.isArray(c.reenvios) ? c.reenvios : []).map((r) => ({ para: str(r.para), telefono: str(r.telefono), texto: str(r.texto), enviar: r.enviar !== false, edit: false }));
      const resp = str(c.respuesta);
      state.drafts.set(c.id, { sel: resp ? (opts.indexOf(resp) >= 0 ? opts.indexOf(resp) : -2) : opts.length ? 0 : -1, text: resp || opts[0] || "", fwd, nota: str(c.nota), showNote: !!c.nota });
    }
    return state.drafts.get(c.id);
  }
  function despues(id) { // tras actuar en el detalle, pasa al siguiente caso (como en las bandejas rápidas)
    if (!state.detalle) { renderSafe(); return; }
    const i = state.orden.indexOf(id);
    const resto = state.orden.slice(i + 1).concat(state.orden.slice(0, Math.max(0, i)));
    const sig = resto.find((x) => { const c = state.cases.get(x); return c && enTab(c, state.tab); });
    if (sig) { state.detalle = sig; window.scrollTo({ top: 0 }); render(); }
    else cerrarDetalle();
  }
  function aprobar(c, abrir) {
    const d = draftFor(c);
    const texto = d.text.trim();
    const reenvios = d.fwd.map((r) => ({ para: r.para, telefono: r.telefono, texto: r.texto.trim(), enviar: !!r.enviar, enviado: false }));
    if (c.destinatario && !texto) { toast("Elige o escribe una respuesta."); return; }
    if (!texto && !reenvios.some((r) => r.enviar && r.texto)) { toast("No hay nada para enviar."); return; }
    if (/\[[^\]]+\]/.test(texto) || reenvios.some((r) => r.enviar && /\[[^\]]+\]/.test(r.texto))) { toast("Completa lo que está entre corchetes, por ejemplo [fecha]."); return; }
    state.drafts.delete(c.id);
    queue(c.id, { estado: "Aprobado", respuesta: texto, reenvios, nota: d.nota.trim(), aprobado: true, respuesta_enviada: false, pospuesto: "" });
    buzz();
    if (!abrir) {
      toast("Aprobado. Queda en Por enviar.", () => queue(c.id, { estado: "Pendiente", aprobado: false }));
      despues(c.id);
      return;
    }
    const env = enviosDe(state.cases.get(c.id)).find((e) => !e.enviado);
    if (env) abrirWhatsApp(c.id, env);
  }
  function resolver(c, nota) {
    state.drafts.delete(c.id);
    const cambios = { estado: "Resuelto", pospuesto: "" };
    if (nota !== undefined) cambios.nota = nota;
    queue(c.id, cambios);
    buzz();
    toast("Resuelto: " + (primerNombre(c) || c.chat), () => queue(c.id, { estado: "Pendiente" }));
  }
  function descartar(c) {
    state.drafts.delete(c.id);
    queue(c.id, { estado: "Descartado", pospuesto: "" });
    toast("Descartado", () => queue(c.id, { estado: "Pendiente" }));
  }
  function marcarEnviado(id, key) {
    const c = state.cases.get(id);
    if (!c) return null;
    const cambios = {};
    if (key === "r") cambios.respuesta_enviada = true;
    else { const i = Number(key.slice(1)); cambios.reenvios = (c.reenvios || []).map((r, j) => (j === i ? { ...r, enviado: true } : r)); }
    if (enviosDe(applyCambios(c, cambios)).every((e) => e.enviado)) cambios.estado = "Enviado";
    queue(id, cambios);
    buzz();
    return state.cases.get(id);
  }
  function posponer(c, luego) {
    elegirMomento("¿Cuándo te lo recuerdo?", "El caso sale de la bandeja y vuelve a esa hora.", (iso) => {
      queue(c.id, { pospuesto: iso });
      toast("Vuelve " + when(iso).toLowerCase(), () => queue(c.id, { pospuesto: "" }));
      if (luego) luego();
    });
  }
  function programarSeguimiento(c, luego) {
    elegirMomento("¿Cuándo reviso si respondió?", "Si " + (primerNombre(c) || "la persona") + " no ha respondido, el caso aparece en Seguimiento.", (iso) => {
      queue(c.id, { seguimiento: iso });
      toast("Te recuerdo " + when(iso).toLowerCase());
      if (luego) luego();
    });
  }
  function preguntarSeguimiento(c) {
    if (!c || !c.destinatario) { toast("Caso enviado"); return; }
    abrirHoja(
      el("h2", { text: "Caso enviado" }),
      el("p", { text: "¿Te recuerdo revisar si " + (primerNombre(c) || "la persona") + " respondió?" }),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn", text: "Mañana a las 8:00 a. m.", onclick: () => { cerrarHoja(); queue(c.id, { seguimiento: diaHabil(1) }); toast("Listo, te recuerdo mañana"); } }),
        el("button", { type: "button", class: "btn", text: "Elegir otro momento", onclick: () => { cerrarHoja(); programarSeguimiento(c); } }),
        el("button", { type: "button", class: "btn quiet", text: "No hace falta", onclick: cerrarHoja })),
    );
  }
  function pasarCaso(c) {
    const fecha = c.recibido ? fmtCorta.format(new Date(c.recibido)) : "";
    let elegido = null;
    const ta = el("textarea", { rows: 6, "aria-label": "Mensaje para el compañero" });
    const armar = (nombre) => {
      const lineas = ["Hola" + (nombre ? " " + nombre.split(" ")[0] : "") + ", te paso este caso de " + (c.persona || c.chat) + (lugar(c) ? " (" + lugar(c) + ")" : "") + (fecha ? ", recibido el " + fecha : "") + ":", str(c.resumen)];
      if (c.accion) lineas.push("Qué hacer: " + c.accion);
      return lineas.join("\n");
    };
    ta.value = armar("");
    const lista = el("div", { class: "filters", role: "group", "aria-label": "Compañeros" });
    const pintar = () => lista.replaceChildren(...state.equipo.map((p) => el("button", { type: "button", class: "chip", "aria-pressed": String(elegido === p), text: p.nombre, onclick: () => { elegido = p; ta.value = armar(p.nombre); pintar(); } })));
    pintar();
    abrirHoja(
      el("h2", { text: "Pasar el caso a un compañero" }),
      el("p", { text: "Elige a quién. Si no tiene número guardado, WhatsApp te deja escoger el chat." }),
      lista, ta,
      el("div", { class: "btns" },
        conIcono("btn wa solid", IC.wa, "Abrir WhatsApp", () => {
          const texto = ta.value.trim(); if (!texto) return;
          const quien = elegido ? elegido.nombre : "un compañero";
          if (!elegido || !normTel(elegido.telefono)) copiar(texto);
          abrirUrl(waUrl(elegido ? elegido.telefono : "", texto));
          const nota = [str(c.nota).trim(), "Pasado a " + quien + " el " + fmtCorta.format(new Date())].filter(Boolean).join("\n");
          queue(c.id, { asignado: quien, nota });
          cerrarHoja();
        }),
        el("button", { type: "button", class: "btn quiet", text: "Cancelar", onclick: cerrarHoja })),
    );
  }
  function elegirPlantilla(c, d) {
    const lista = plantillasPara(c);
    abrirHoja(
      el("h2", { text: "Respuestas guardadas" }),
      lista.length ? el("p", { text: "Se llenan solas con el nombre y el hogar. Lo que quede entre corchetes lo completas tú." }) : el("p", { text: "Aún no hay plantillas. Escribe una respuesta y toca «Guardar como plantilla»." }),
      el("div", { class: "btns" }, ...lista.map((p) => el("button", { type: "button", class: "tpl", onclick: () => {
        d.sel = -2; d.text = rellenar(p.texto, c); cerrarHoja(); render();
        const ta = $("resp-" + c.id); if (ta) { ta.focus(); const i = ta.value.indexOf("["); if (i >= 0) ta.setSelectionRange(i, ta.value.indexOf("]", i) + 1); }
      } }, el("b", { text: p.nombre }), el("span", { text: p.texto })))),
      el("button", { type: "button", class: "btn quiet", text: "Cerrar", onclick: cerrarHoja }),
    );
  }
  function guardarPlantilla(c, texto) {
    const inp = el("input", { type: "text", placeholder: "Por ejemplo: Fecha de pago", "aria-label": "Nombre de la plantilla" });
    let base = str(texto);
    const nombre = primerNombre(c);
    if (nombre) base = base.replace(new RegExp("\\b" + nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), "{nombre}");
    if (c.hogar) base = base.split(c.hogar).join("{hogar}");
    const ta = el("textarea", { rows: 4, "aria-label": "Texto de la plantilla" });
    ta.value = base;
    abrirHoja(
      el("h2", { text: "Guardar como plantilla" }),
      el("p", { text: "Puedes usar {nombre}, {hogar}, {municipio} y [fecha] para lo que cambia cada vez." }),
      inp, ta,
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn primary", text: "Guardar plantilla", onclick: () => {
          const n = inp.value.trim(), tx = ta.value.trim();
          if (!n || !tx) { toast("Ponle nombre y texto."); return; }
          const op = { k: "plantilla", datos: { nombre: n, texto: tx, categoria: str(c.categoria) } };
          aplicarLocal(op); encolar(op); cerrarHoja(); toast("Plantilla guardada");
        } }),
        el("button", { type: "button", class: "btn quiet", text: "Cancelar", onclick: cerrarHoja })),
    );
  }

  // ---------- confirmación al volver de WhatsApp ----------
  function revisarEnvio() {
    const p = store.get(K.envio);
    if (!p || now() - p.t < 1200) return;
    const c = state.cases.get(p.id);
    if (!c) { store.del(K.envio); return; }
    const env = enviosDe(c).find((e) => e.key === p.key);
    if (!env || env.enviado) { store.del(K.envio); return; }
    abrirHoja(
      el("h2", { text: "¿Se envió el mensaje a " + env.para + "?" }),
      el("p", { text: "Confírmalo para dejarlo registrado en la bitácora." }),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn primary", text: "Sí, se envió", onclick: () => { store.del(K.envio); cerrarHoja(); siguienteEnvio(marcarEnviado(c.id, env.key)); } }),
        conIcono("btn wa", IC.wa, "Abrir WhatsApp otra vez", () => { cerrarHoja(); abrirWhatsApp(c.id, env); }),
        el("button", { type: "button", class: "btn quiet", text: "No, lo envío después", onclick: () => { store.del(K.envio); cerrarHoja(); } })),
    );
  }
  function siguienteEnvio(c) {
    if (!c) return;
    const env = enviosDe(c).find((e) => !e.enviado);
    if (!env) { preguntarSeguimiento(c); if (state.detalle === c.id) despues(c.id); return; }
    abrirHoja(
      el("h2", { text: "Falta enviar a " + env.para }),
      el("p", { text: env.texto.length > 160 ? env.texto.slice(0, 160) + "…" : env.texto }),
      el("div", { class: "btns" },
        conIcono("btn wa solid", IC.wa, "Abrir WhatsApp", () => { cerrarHoja(); abrirWhatsApp(c.id, env); }),
        el("button", { type: "button", class: "btn quiet", text: "Más tarde", onclick: cerrarHoja })),
    );
  }

  // ---------- fila de caso (con deslizar) ----------
  function etiquetas(c, completo) {
    const tags = el("div", { class: "tags" });
    tags.append(el("span", { class: "tag cat " + (CAT_CLASE[c.categoria] || ""), text: CORTO[c.categoria] || str(c.categoria) || "Sin categoría" }));
    parseDocs(c).forEach((d) => {
      const rango = d.desde && d.hasta && !/no aparece/i.test(d.desde) ? " " + fechaCorta(d.desde) + "–" + fechaCorta(d.hasta) : "";
      tags.append(el("span", { class: "tag doc", html: IC.doc }, document.createTextNode(d.tipo + rango)));
    });
    const dl = deadline(c); if (dl) tags.append(el("span", { class: "tag " + dl.clase, text: dl.texto }));
    if (recordatorio(c)) tags.append(el("span", { class: "tag yel", text: "Volvió del pospuesto" }));
    if (c.asignado) tags.append(el("span", { class: "tag", text: "Pasado a " + c.asignado }));
    if (completo && c.origen === "Audio") tags.append(el("span", { class: "tag", text: "Audio transcrito" }));
    if (c.estado === "Aprobado") { const f = enviosDe(c).filter((e) => !e.enviado).length; tags.append(el("span", { class: "tag yel", text: f ? "Falta enviar " + f : "Por enviar" })); }
    if (c.seguimiento && c.estado !== "Pendiente") tags.append(el("span", { class: "tag grn", text: "Seguimiento " + when(c.seguimiento).toLowerCase() }));
    return tags;
  }
  function fila(c, opciones = {}) {
    const wrap = el("div", { class: "row-wrap" });
    const sel = state.sel;
    const seleccionado = sel && sel.has(c.id);
    const izquierda = sel
      ? el("span", { class: "avatar check" + (seleccionado ? " on" : ""), html: seleccionado ? IC.check : "", "aria-hidden": "true" })
      : avatar(c.persona || c.chat, c.municipio, esGrupo(c));
    const e = edad(c);
    const ctx = [esGrupo(c) ? "En " + c.chat : "", lugar(c)].filter(Boolean).join(". ");
    const row = el("div", { class: "row", role: sel ? "checkbox" : "button", tabindex: "0", "data-prio": str(c.prioridad) || "Normal", "aria-checked": sel ? String(!!seleccionado) : undefined, "aria-label": (c.persona || c.chat) + ". " + str(c.resumen) },
      izquierda,
      el("div", { class: "r-main" },
        el("div", { class: "r-top" }, el("span", { class: "r-name", text: str(c.persona) || str(c.chat) }), el("span", { class: "r-age " + e.clase, text: e.texto })),
        ctx ? el("div", { class: "r-ctx", text: ctx }) : null,
        el("div", { class: "r-sum", text: str(c.resumen) }),
        etiquetas(c, false)));
    const abrir = () => {
      if (state.sel) { state.sel.has(c.id) ? state.sel.delete(c.id) : state.sel.add(c.id); render(); return; }
      abrirDetalle(c.id, opciones.orden);
    };
    row.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } });
    if (opciones.deslizar && !sel) {
      const bg = el("div", { class: "swipe-bg", "aria-hidden": "true" },
        el("span", { class: "l", html: IC.check + "<span>Resuelto</span>" }),
        el("span", { class: "r", html: "<span>Posponer</span>" + IC.reloj }));
      wrap.append(bg);
      let x0 = 0, y0 = 0, dx = 0, activo = false, arrastra = false, suprimir = false;
      row.addEventListener("pointerdown", (ev) => { if (ev.button) return; x0 = ev.clientX; y0 = ev.clientY; dx = 0; activo = true; arrastra = false; });
      row.addEventListener("pointermove", (ev) => {
        if (!activo) return;
        const mx = ev.clientX - x0, my = ev.clientY - y0;
        if (!arrastra) {
          if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4) { arrastra = true; row.classList.add("dragging"); try { row.setPointerCapture(ev.pointerId); } catch (x) {} }
          else if (Math.abs(my) > 12) { activo = false; return; }
          else return;
        }
        dx = Math.max(-160, Math.min(160, mx));
        row.style.transform = "translateX(" + dx + "px)";
        bg.className = "swipe-bg " + (dx > 0 ? "go-r" : "go-l");
      });
      const fin = () => {
        if (!activo) return;
        activo = false;
        if (!arrastra) return;
        suprimir = true;
        row.classList.remove("dragging"); row.classList.add("back");
        row.style.transform = "";
        setTimeout(() => row.classList.remove("back"), 220);
        if (dx > 90) resolver(c);
        else if (dx < -90) posponer(c);
      };
      row.addEventListener("pointerup", fin);
      row.addEventListener("pointercancel", () => { activo = false; row.style.transform = ""; row.classList.remove("dragging"); });
      row.addEventListener("click", (ev) => { if (suprimir) { suprimir = false; ev.preventDefault(); return; } abrir(); });
    } else row.addEventListener("click", abrir);
    wrap.append(row);
    return wrap;
  }

  // ---------- vista: bandeja ----------
  function filtrosCat(pool) {
    const present = new Set(pool.map((c) => c.categoria));
    const chips = CATS.filter(([v]) => !v || present.has(v) || state.cat === v);
    if (chips.length <= 2 && !state.cat) return null;
    return el("div", { class: "filters", role: "group", "aria-label": "Filtrar por categoría" },
      ...chips.map(([v, label]) => el("button", { type: "button", class: "chip", "aria-pressed": String(state.cat === v), text: label, onclick: () => { state.cat = v; render(); } })));
  }
  function buscador(valor, placeholder, onInput, id) {
    const inp = el("input", { type: "search", id, placeholder, "aria-label": placeholder, autocomplete: "off" });
    inp.value = valor;
    inp.addEventListener("input", () => onInput(inp.value));
    return el("div", { class: "search", html: IC.lupa }, inp);
  }
  function vistaBandeja(all) {
    const pend = all.filter((c) => enTab(c, "pend"));
    const ready = all.filter((c) => enTab(c, "ready"));
    const urgent = pend.filter((c) => c.prioridad === "Urgente");
    const out = [];
    const tabs = el("div", { class: "tabs", role: "tablist", "aria-label": "Estado de los casos" });
    [["pend", "Por responder", pend.length], ["ready", "Por enviar", ready.length], ["closed", "Hechos", null]].forEach(([k, l, n]) => tabs.append(
      el("button", { type: "button", role: "tab", "aria-selected": String(state.tab === k), onclick: () => { state.tab = k; state.cat = ""; state.sel = null; render(); window.scrollTo({ top: 0 }); } },
        document.createTextNode(l), n ? el("span", { class: "n", text: String(n) }) : null)));
    out.push(tabs);
    const herramientas = el("div", { class: "toolrow" }, buscador(state.buscar, "Buscar profe, hogar o municipio", (v) => { state.buscar = v; pintarLista(); }, "q-bandeja"));
    if (state.tab === "pend" && pend.length) herramientas.append(el("button", { type: "button", class: "textbtn", text: state.sel ? "Cancelar" : "Seleccionar", onclick: () => { state.sel = state.sel ? null : new Set(); render(); } }));
    out.push(herramientas);
    if (state.tab === "pend" && urgent.length && !state.sel) out.push(el("button", { type: "button", class: "alert", onclick: () => abrirDetalle(urgent.sort(ordenPend)[0].id) },
      el("span", { class: "dot" }), document.createTextNode(urgent.length === 1 ? "1 caso urgente sin resolver. Ábrelo primero." : urgent.length + " casos urgentes sin resolver.")));
    if (state.tab === "ready" && ready.length) out.push(el("div", { class: "note", text: "Para que Claude los envíe todos, escríbele «enviar los aprobados». También puedes abrir cada uno y enviarlo tú." }));
    const host = el("div", { class: "stack" });
    out.push(host);
    function pintarLista() {
      const pool = all.filter((c) => enTab(c, state.tab)).filter((c) => coincide(c, state.buscar));
      const kids = [];
      const fc = filtrosCat(pool); if (fc) kids.push(fc);
      const lista = pool.filter((c) => !state.cat || c.categoria === state.cat);
      if (!lista.length) {
        const msg = state.buscar ? "Nada coincide con la búsqueda." : state.tab === "pend" ? (state.cat ? "No hay casos en esta categoría." : (state.lastSync || all.length ? "Todo al día" : "Cargando casos…"))
          : state.tab === "ready" ? "No hay mensajes esperando envío." : "Todavía no hay casos cerrados.";
        const hint = state.tab === "pend" && !state.buscar && !state.cat && state.lastSync ? "Cuando quieras revisar WhatsApp, escríbele a Claude «hacer revisión»." : "";
        kids.push(el("div", { class: "empty" }, state.tab === "pend" && !state.buscar && !state.cat ? el("div", { html: IC.hoja }) : null, el("strong", { text: msg }), hint ? document.createTextNode(hint) : null));
        host.replaceChildren(...kids);
        return;
      }
      if (state.tab === "pend") {
        const secs = seccionesPend(lista);
        const orden = secs.flatMap((s) => s.casos.map((c) => c.id));
        secs.filter((s) => s.casos.length).forEach((s) => {
          const plegada = state.plegadas.has(s.key);
          const h = el("button", { type: "button", class: "sec-h", "aria-expanded": String(!plegada), onclick: () => { plegada ? state.plegadas.delete(s.key) : state.plegadas.add(s.key); store.set(K.plegadas, [...state.plegadas]); render(); } },
            el("h2", {}, el("span", { class: "mark", style: "background:" + s.color }), document.createTextNode(s.titulo), el("span", { class: "count", text: String(s.casos.length) })),
            el("span", { class: "chev", html: IC.abajo }));
          const sec = el("section", { class: "section" }, h);
          if (!plegada) sec.append(el("div", { class: "list" }, ...s.casos.map((c) => fila(c, { deslizar: true, orden }))));
          kids.push(sec);
        });
      } else {
        const orden = casosDeTab(state.tab).map((c) => c.id);
        const casos = orden.map((id) => state.cases.get(id)).filter((c) => c && (!state.cat || c.categoria === state.cat) && coincide(c, state.buscar));
        kids.push(el("div", { class: "list" }, ...casos.map((c) => fila(c, { orden }))));
      }
      host.replaceChildren(...kids);
    }
    pintarLista();
    return out;
  }
  function barraSeleccion() {
    const root = $("selbar-root");
    if (!state.sel || state.detalle || state.vista !== "bandeja") { root.replaceChildren(); return; }
    const ids = [...state.sel].filter((id) => state.cases.has(id));
    const casos = ids.map((id) => state.cases.get(id));
    root.replaceChildren(el("div", { class: "selbar", role: "toolbar", "aria-label": "Acciones para varios casos" },
      el("span", { text: ids.length ? ids.length + (ids.length === 1 ? " caso" : " casos") : "Toca los casos" }),
      el("div", { class: "btns" },
        el("button", { type: "button", text: "Posponer", disabled: !ids.length, onclick: () => elegirMomento("¿Cuándo vuelven?", ids.length + " casos salen de la bandeja y vuelven a esa hora.", (iso) => { casos.forEach((c) => queue(c.id, { pospuesto: iso })); state.sel = null; toast(ids.length + " pospuestos"); render(); }) }),
        el("button", { type: "button", text: "Resolver", disabled: !ids.length, onclick: () => { casos.forEach((c) => { state.drafts.delete(c.id); queue(c.id, { estado: "Resuelto", pospuesto: "" }); }); state.sel = null; toast(ids.length + " resueltos", () => casos.forEach((c) => queue(c.id, { estado: "Pendiente" }))); render(); } }),
        el("button", { type: "button", class: "go", text: "Aprobar", disabled: !ids.length, onclick: () => aprobarVarios(casos) }))));
  }
  function aprobarVarios(casos) {
    const listos = [], sinOpcion = [];
    casos.forEach((c) => {
      const op = Array.isArray(c.opciones) && c.opciones.length ? str(c.opciones[0]).trim() : "";
      if (c.destinatario && op && !/\[[^\]]+\]/.test(op)) listos.push({ c, op }); else sinOpcion.push(c);
    });
    if (!listos.length) { toast("Ninguno tiene una respuesta lista: ábrelos para escribirla."); return; }
    abrirHoja(
      el("h2", { text: "Aprobar " + listos.length + (listos.length === 1 ? " caso" : " casos") }),
      el("p", { text: "Se aprueba la primera respuesta sugerida de cada uno y quedan en Por enviar." + (sinOpcion.length ? " " + sinOpcion.length + " no se aprueban porque necesitan que completes algo." : "") }),
      el("div", { class: "btns" }, ...listos.slice(0, 6).map(({ c, op }) => el("div", { class: "tpl" }, el("b", { text: c.persona || c.chat }), el("span", { text: op })))),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn primary", text: "Aprobar " + listos.length, onclick: () => {
          listos.forEach(({ c, op }) => {
            const reenvios = (Array.isArray(c.reenvios) ? c.reenvios : []).map((r) => ({ para: str(r.para), telefono: str(r.telefono), texto: str(r.texto), enviar: r.enviar !== false && !/\[[^\]]+\]/.test(str(r.texto)), enviado: false }));
            state.drafts.delete(c.id);
            queue(c.id, { estado: "Aprobado", respuesta: op, reenvios, aprobado: true, respuesta_enviada: false, pospuesto: "" });
          });
          cerrarHoja(); state.sel = null; toast(listos.length + " aprobados. Están en Por enviar."); render();
        } }),
        el("button", { type: "button", class: "btn quiet", text: "Cancelar", onclick: cerrarHoja })),
    );
  }

  // ---------- vista: detalle de un caso ----------
  function abrirDetalle(id, orden) {
    if (!state.detalle) { try { history.pushState({ detalle: true }, ""); } catch (e) {} }
    state.orden = orden && orden.length ? orden : casosDeTab(state.tab).map((c) => c.id);
    if (!state.orden.includes(id)) state.orden.unshift(id);
    state.detalle = id;
    window.scrollTo({ top: 0 });
    render();
  }
  function cerrarDetalle() {
    if (history.state && history.state.detalle) { history.back(); return; }
    state.detalle = null; render();
  }
  window.addEventListener("popstate", () => { if (state.detalle) { state.detalle = null; cerrarHoja(); render(); } });

  function hiloDe(c) {
    const hilo = parseHilo(c);
    if (!hilo) return c.mensaje ? el("div", { class: "rawmsg", text: str(c.mensaje) }) : null;
    const todos = state.hiloCompleto.has(c.id);
    const visibles = todos ? hilo : hilo.slice(-6);
    const box = el("div", { class: "thread" });
    let dia = "";
    visibles.forEach((m) => {
      if (m.fecha && m.fecha !== dia) { dia = m.fecha; box.append(el("span", { class: "day", text: fechaCorta(m.fecha) })); }
      const b = el("div", { class: "bub" + (m.yo ? " yo" : "") + (m.audio ? " audio" : "") });
      if (m.autor && !m.yo) b.append(el("span", { class: "au", text: m.autor }));
      b.append(document.createTextNode(m.texto));
      if (m.hora) b.append(el("span", { class: "tm", text: m.hora }));
      box.append(b);
    });
    const frag = el("div", { class: "stack" }, el("p", { class: "block-h" }, document.createTextNode("Conversación"), hilo.length > 6 ? el("button", { type: "button", text: todos ? "Ver menos" : "Ver todo (" + hilo.length + ")", onclick: () => { todos ? state.hiloCompleto.delete(c.id) : state.hiloCompleto.add(c.id); render(); } }) : null), box);
    return frag;
  }
  function tarjetaDoc(d) {
    const card = el("div", { class: "docc" },
      el("div", { class: "dh" }, el("span", { class: "ic", html: IC.doc }), el("div", {}, el("div", { class: "dt", text: d.tipo }), d.archivo ? el("div", { class: "df", text: d.archivo }) : null)));
    if (d.desde || d.hasta || d.dias) {
      const r = el("div", { class: "range" },
        el("div", { class: "d" }, el("small", { text: "Desde" }), el("b", { text: d.desde ? fechaCorta(d.desde) : "—" })),
        el("span", { class: "arrow", text: "→" }),
        el("div", { class: "d" }, el("small", { text: "Hasta" }), el("b", { text: d.hasta ? fechaCorta(d.hasta) : "—" })));
      r.append(d.dias ? el("div", { class: "days" }, el("b", { text: d.dias }), el("small", { text: d.dias === "1" ? "día" : "días" })) : el("span"));
      card.append(r);
    }
    if (d.dx) card.append(el("div", { class: "dx" }, el("small", { text: "Diagnóstico" }), document.createTextNode(d.dx)));
    return card;
  }
  function vistaDetalle(c) {
    const out = [];
    const i = state.orden.indexOf(c.id);
    const total = state.orden.length;
    const ir = (k) => { const id = state.orden[k]; if (id && state.cases.has(id)) { state.detalle = id; window.scrollTo({ top: 0 }); render(); } };
    out.push(el("div", { class: "dtop-wrap" }, el("div", { class: "dtop" },
      el("button", { type: "button", class: "back", html: IC.atras + "<span>Bandeja</span>", onclick: cerrarDetalle }),
      total > 1 && i >= 0 ? el("div", { class: "pager" },
        el("span", { text: (i + 1) + " de " + total }),
        el("button", { type: "button", "aria-label": "Caso anterior", html: IC.arriba, disabled: i <= 0, onclick: () => ir(i - 1) }),
        el("button", { type: "button", "aria-label": "Caso siguiente", html: IC.abajo, disabled: i >= total - 1, onclick: () => ir(i + 1) })) : null)));
    const tel = normTel(c.telefono);
    out.push(el("div", { class: "who-h" }, avatar(c.persona || c.chat, c.municipio, esGrupo(c)),
      el("div", {}, el("button", { type: "button", class: "nm", text: str(c.persona) || str(c.chat), onclick: () => abrirFicha(c.persona || c.chat) }),
        [esGrupo(c) ? "En " + c.chat : "", lugar(c)].some(Boolean) ? el("div", { class: "ctx", text: [esGrupo(c) ? "En " + c.chat : "", lugar(c)].filter(Boolean).join(". ") }) : null,
        el("div", { class: "ctx", text: "Último mensaje: " + when(ultimoDe(c)).toLowerCase() }))));
    const quick = el("div", { class: "quick" });
    if (tel) quick.append(el("a", { href: "tel:+" + tel, html: IC.tel + "<span>Llamar</span>" }), conIcono("", IC.wa, "Chat", () => abrirUrl(waUrl(tel, ""))));
    quick.append(conIcono("", IC.ficha, "Ficha", () => abrirFicha(c.persona || c.chat)));
    out.push(quick);
    out.push(el("p", { class: "lead", text: str(c.resumen) }));
    if (c.accion && c.estado === "Pendiente") out.push(el("div", { class: "todo", html: IC.tarea }, el("div", {}, el("b", { text: "Qué hacer" }), document.createTextNode(str(c.accion)))));
    out.push(etiquetas(c, true));
    parseDocs(c).forEach((d) => out.push(tarjetaDoc(d)));
    const hilo = hiloDe(c); if (hilo) out.push(hilo);

    let barra;
    if (c.estado === "Pendiente") barra = detallePendiente(c, out);
    else if (c.estado === "Aprobado") barra = detallePorEnviar(c, out);
    else barra = detalleCerrado(c, out);
    return { nodos: out, barra };
  }
  function detallePendiente(c, out) {
    const d = draftFor(c);
    const opts = Array.isArray(c.opciones) ? c.opciones.map(str) : [];
    if (c.destinatario) {
      const comp = el("div", { class: "compose" });
      comp.append(el("p", { class: "block-h", text: "Respuesta para " + str(c.destinatario) }));
      if (opts.length) {
        const sugs = el("div", { class: "filters", role: "group", "aria-label": "Respuestas sugeridas" });
        opts.forEach((o, k) => sugs.append(el("button", { type: "button", class: "chip", "aria-pressed": String(d.sel === k), text: "Sugerencia " + (k + 1), title: o, onclick: () => { d.sel = k; d.text = o; render(); } })));
        sugs.append(el("button", { type: "button", class: "chip", "aria-pressed": String(d.sel < 0), text: "Escribir otra", onclick: () => { if (d.sel >= 0) { d.sel = -1; d.text = ""; } render(); const x = $("resp-" + c.id); if (x) x.focus(); } }));
        comp.append(sugs);
      }
      const ta = el("textarea", { id: "resp-" + c.id, "aria-label": "Texto de la respuesta", rows: 5, placeholder: "Escribe la respuesta como la enviarías" });
      ta.value = d.text;
      ta.addEventListener("input", () => { d.text = ta.value; d.sel = opts.indexOf(ta.value); if (d.sel < 0) d.sel = -2; });
      comp.append(ta);
      comp.append(el("div", { class: "links" },
        el("button", { type: "button", class: "link", text: "Usar plantilla", onclick: () => elegirPlantilla(c, d) }),
        el("button", { type: "button", class: "link", text: "Guardar como plantilla", onclick: () => guardarPlantilla(c, d.text) })));
      if (!normTel(c.telefono)) comp.append(el("p", { class: "sub", text: "Sin número guardado: WhatsApp te pedirá elegir el chat y el texto queda copiado." }));
      out.push(comp);
    }
    d.fwd.forEach((r, k) => {
      const cb = el("input", { type: "checkbox", id: "fwd-" + c.id + "-" + k, role: "switch" });
      cb.checked = r.enviar;
      cb.addEventListener("change", () => { r.enviar = cb.checked; render(); });
      const fwd = el("div", { class: "fwd" }, el("label", { class: "switch", for: cb.id }, el("span", {}, document.createTextNode("Enviar también a " + r.para), el("span", { class: "num", text: r.telefono || "sin número" })), cb));
      if (r.enviar) {
        if (r.edit) { const x = el("textarea", { id: "fwdt-" + c.id + "-" + k, rows: 5, "aria-label": "Mensaje para " + r.para }); x.value = r.texto; x.addEventListener("input", () => { r.texto = x.value; }); fwd.append(x); }
        else fwd.append(el("button", { type: "button", class: "link", text: "Ver o editar el mensaje", onclick: () => { r.edit = true; render(); } }));
      }
      out.push(fwd);
    });
    if (d.showNote) {
      const note = el("textarea", { id: "nota-" + c.id, rows: 2, placeholder: "Nota para la bitácora", "aria-label": "Nota" });
      note.style.minHeight = "64px"; note.value = d.nota; note.addEventListener("input", () => { d.nota = note.value; });
      out.push(note);
    } else out.push(el("button", { type: "button", class: "link", text: "Agregar una nota", onclick: () => { d.showNote = true; render(); const n = $("nota-" + c.id); if (n) n.focus(); } }));

    const hayEnvio = !!c.destinatario || d.fwd.some((r) => r.enviar);
    const main = el("div", { class: "main" + (hayEnvio ? "" : " one") });
    if (hayEnvio) main.append(
      el("button", { type: "button", class: "btn primary", text: "Aprobar", title: "Queda en Por enviar para que Claude lo envíe", onclick: () => aprobar(c, false) }),
      conIcono("btn wa", IC.wa, "Enviar yo", () => aprobar(c, true)));
    else main.append(conIcono("btn primary", IC.check, "Marcar resuelto", () => { resolver(c, d.nota.trim()); despues(c.id); }));
    const sec = [
      hayEnvio ? ["Resuelto", IC.check, () => { resolver(c, d.nota.trim()); despues(c.id); }] : null,
      ["Posponer", IC.reloj, () => posponer(c, () => despues(c.id))],
      ["Pasar", IC.pasar, () => pasarCaso(c)],
      ["Descartar", IC.basura, () => { descartar(c); despues(c.id); }],
    ].filter(Boolean);
    return barraAcciones(main, sec);
  }
  function detallePorEnviar(c, out) {
    out.push(el("p", { class: "block-h", text: "Mensajes aprobados" }));
    enviosDe(c).forEach((env) => {
      const item = el("div", { class: "send-item" },
        el("div", { class: "rr" }, el("span", { text: (env.key === "r" ? "Respuesta a " : "Para ") + env.para }), el("span", { class: "tag " + (env.enviado ? "grn" : "yel"), text: env.enviado ? "Enviado" : "Falta enviar" })),
        el("div", { class: "txt", text: env.texto }));
      if (!env.enviado) item.append(el("div", { class: "bb" },
        conIcono("btn wa solid small", IC.wa, "Abrir", () => abrirWhatsApp(c.id, env)),
        el("button", { type: "button", class: "btn small", text: "Ya lo envié", onclick: () => { const n = marcarEnviado(c.id, env.key); if (n && n.estado === "Enviado") { preguntarSeguimiento(n); despues(c.id); } else render(); } })));
      out.push(item);
    });
    return barraAcciones(null, [
      ["Pasar", IC.pasar, () => pasarCaso(c)],
      ["A pendiente", IC.volver, () => { queue(c.id, { estado: "Pendiente" }); toast("Volvió a Por responder"); }],
    ]);
  }
  function detalleCerrado(c, out) {
    if (c.respuesta) out.push(el("p", { class: "block-h", text: (c.respuesta_enviada || c.estado === "Enviado" ? "Enviado a " : "Respuesta para ") + str(c.destinatario) }), el("div", { class: "final", text: str(c.respuesta) }));
    (Array.isArray(c.reenvios) ? c.reenvios : []).filter((r) => r.enviar && r.texto).forEach((r) => out.push(el("p", { class: "block-h", text: "Para " + str(r.para) }), el("div", { class: "final", text: str(r.texto) })));
    if (c.nota) out.push(el("p", { class: "block-h", text: "Nota" }), el("div", { class: "rawmsg", text: str(c.nota) }));
    if (c.estado === "Enviado" && c.enviado) out.push(el("p", { class: "sub", text: "Enviado " + when(c.enviado).toLowerCase() + (c.seguimiento ? ". Seguimiento " + when(c.seguimiento).toLowerCase() : "") }));
    const sec = [];
    if (c.estado === "Enviado" && c.destinatario && !c.seguimiento) sec.push(["Recordarme", IC.campana, () => programarSeguimiento(c)]);
    sec.push(["Pasar", IC.pasar, () => pasarCaso(c)]);
    sec.push(["A pendiente", IC.volver, () => { queue(c.id, { estado: "Pendiente" }); state.tab = "pend"; toast("Volvió a Por responder"); }]);
    return barraAcciones(null, sec);
  }
  function barraAcciones(main, sec) {
    const s = el("div", { class: "sec" });
    s.style.gridTemplateColumns = "repeat(" + sec.length + ", 1fr)";
    sec.forEach(([l, icon, fn]) => s.append(el("button", { type: "button", html: icon, onclick: fn }, el("span", { text: l }))));
    return el("div", { class: "actbar" }, el("div", { class: "in" }, main, s));
  }

  // ---------- vista: seguimiento ----------
  function itemSeguimiento(c, tipo) {
    const box = el("div", { class: "fu" });
    const cuando = tipo === "venc" ? "Desde " + when(c.seguimiento).toLowerCase() : tipo === "posp" ? "Vuelve " + when(c.pospuesto).toLowerCase() : when(c.seguimiento);
    box.append(
      el("div", { class: "r-top" }, el("button", { type: "button", class: "link", style: "color:var(--ink);font-size:1rem;padding:0", text: str(c.persona) || str(c.chat), onclick: () => abrirFicha(c.persona || c.chat) }), el("span", { class: "r-age", text: cuando })),
      el("div", { class: "r-sum", text: tipo === "venc" ? "¿" + (primerNombre(c) || "La persona") + " ya respondió? " + str(c.resumen) : str(c.resumen) }));
    if (c.respuesta && tipo !== "posp") box.append(el("div", { class: "final", text: "Le escribiste: " + str(c.respuesta) }));
    const acts = el("div", { class: "acts" });
    if (tipo === "venc") acts.append(
      el("button", { type: "button", class: "btn small primary", text: "Ya respondió", onclick: () => { queue(c.id, { seguimiento: "" }); toast("Seguimiento cerrado", () => queue(c.id, { seguimiento: c.seguimiento })); } }),
      conIcono("btn small wa", IC.wa, "Escribirle", () => escribirSeguimiento(c)),
      el("button", { type: "button", class: "btn small quiet", text: "Recordar después", onclick: () => programarSeguimiento(c) }));
    else if (tipo === "posp") acts.append(
      el("button", { type: "button", class: "btn small primary", text: "Traer ahora", onclick: () => { queue(c.id, { pospuesto: "" }); state.vista = "bandeja"; state.tab = "pend"; render(); } }),
      el("button", { type: "button", class: "btn small quiet", text: "Cambiar fecha", onclick: () => posponer(c) }));
    else acts.append(
      el("button", { type: "button", class: "btn small", text: "Cambiar fecha", onclick: () => programarSeguimiento(c) }),
      el("button", { type: "button", class: "btn small quiet", text: "Quitar", onclick: () => { queue(c.id, { seguimiento: "" }); toast("Seguimiento quitado"); } }));
    box.append(acts);
    return box;
  }
  function escribirSeguimiento(c) {
    const tpl = state.plantillas.find((p) => /seguimiento/i.test(p.nombre));
    const ta = el("textarea", { rows: 4, "aria-label": "Mensaje de seguimiento" });
    ta.value = rellenar(tpl ? tpl.texto : "Hola profe, bendiciones. ¿Cómo va {tema}? Quedo atento.", c);
    abrirHoja(
      el("h2", { text: "Escribirle a " + (primerNombre(c) || "la persona") }), ta,
      el("div", { class: "btns" },
        conIcono("btn wa solid", IC.wa, "Abrir WhatsApp", () => {
          const texto = ta.value.trim(); if (!texto) return;
          if (/\[[^\]]+\]/.test(texto)) { toast("Completa lo que está entre corchetes."); return; }
          if (!normTel(c.telefono)) copiar(texto);
          abrirUrl(waUrl(c.telefono, texto));
          queue(c.id, { seguimiento: diaHabil(1), nota: [str(c.nota).trim(), "Seguimiento enviado el " + fmtCorta.format(new Date())].filter(Boolean).join("\n") });
          cerrarHoja(); toast("Te recuerdo mañana si sigue sin responder");
        }),
        el("button", { type: "button", class: "btn quiet", text: "Cancelar", onclick: cerrarHoja })),
    );
  }
  function vistaSeguimiento(all) {
    const venc = all.filter(segVencido).sort((a, b) => t(a.seguimiento) - t(b.seguimiento));
    const prox = all.filter(segFuturo).sort((a, b) => t(a.seguimiento) - t(b.seguimiento));
    const posp = all.filter(pospuesto).sort((a, b) => t(a.pospuesto) - t(b.pospuesto));
    const out = [];
    if (!venc.length && !prox.length && !posp.length) {
      out.push(el("div", { class: "empty" }, el("div", { html: IC.hoja }), el("strong", { text: "Nada pendiente de seguimiento" }),
        document.createTextNode("Al enviar una respuesta puedes pedir que te recuerde si la persona no contesta. En la bandeja, desliza un caso a la izquierda para posponerlo.")));
      return out;
    }
    const sec = (titulo, color, casos, tipo) => el("section", { class: "section" },
      el("div", { class: "sec-h", style: "cursor:default" }, el("h2", {}, el("span", { class: "mark", style: "background:" + color }), document.createTextNode(titulo), el("span", { class: "count", text: String(casos.length) }))),
      el("div", { class: "list" }, ...casos.map((c) => itemSeguimiento(c, tipo))));
    if (venc.length) out.push(sec("Para revisar ahora", "var(--hibiscus)", venc, "venc"));
    if (posp.length) out.push(sec("Pospuestos", "var(--banana)", posp, "posp"));
    if (prox.length) out.push(sec("Próximos seguimientos", "var(--gulf)", prox, "prox"));
    return out;
  }

  // ---------- vista: personas y ficha ----------
  function personasDe(all) {
    const m = new Map();
    for (const c of all) {
      const nombre = str(c.persona || c.chat).trim();
      if (!nombre) continue;
      const k = norm(nombre);
      let p = m.get(k);
      if (!p) { p = { key: k, nombre, hogar: "", municipio: "", telefono: "", casos: [], abiertos: 0, ultimo: 0 }; m.set(k, p); }
      p.casos.push(c);
      const tt = t(c.recibido);
      if (tt >= p.ultimo) { p.ultimo = tt; p.nombre = nombre; }
      if (c.hogar && !p.hogar) p.hogar = c.hogar;
      if (c.municipio && !p.municipio) p.municipio = c.municipio;
      if (normTel(c.telefono) && !p.telefono) p.telefono = c.telefono;
      if (!CERRADOS.includes(c.estado)) p.abiertos++;
    }
    for (const f of state.fichas) {
      const k = norm(f.persona);
      let p = m.get(k);
      if (!p) { p = { key: k, nombre: f.persona, hogar: "", municipio: "", telefono: "", casos: [], abiertos: 0, ultimo: 0 }; m.set(k, p); }
      p.ficha = f;
      if (f.hogar) p.hogar = f.hogar;
      if (f.municipio) p.municipio = f.municipio;
      if (normTel(f.telefono)) p.telefono = f.telefono;
    }
    return [...m.values()].sort((a, b) => b.ultimo - a.ultimo);
  }
  function abrirFicha(nombre) {
    state.persona = norm(nombre);
    if (state.detalle) { state.detalle = null; if (history.state && history.state.detalle) { try { history.replaceState(null, ""); } catch (e) {} } }
    state.vista = "personas";
    store.set(K.vista, state.vista);
    cerrarHoja();
    render();
    window.scrollTo({ top: 0 });
  }
  function vistaPersonas(all) {
    const gente = personasDe(all);
    if (state.persona) {
      const p = gente.find((x) => x.key === state.persona);
      if (p) return vistaFicha(p);
      state.persona = null;
    }
    const lista = el("div", { class: "list" });
    const out = [buscador(state.buscarP, "Buscar por nombre, hogar o municipio", (v) => { state.buscarP = v; pintar(); }, "q-personas"), lista];
    function pintar() {
      const q = norm(state.buscarP);
      const sel = gente.filter((p) => !q || norm([p.nombre, p.hogar, p.municipio].join(" ")).includes(q));
      if (!sel.length) { lista.replaceChildren(el("div", { class: "empty" }, el("strong", { text: gente.length ? "Nadie coincide con la búsqueda." : "Aún no hay personas." }))); return; }
      lista.replaceChildren(...sel.slice(0, 150).map((p) => el("button", { type: "button", class: "prow", onclick: () => abrirFicha(p.nombre) },
        avatar(p.nombre, p.municipio, false),
        el("span", {}, el("span", { class: "nm", text: p.nombre }), el("br"), el("span", { class: "mt", text: [p.hogar, p.municipio].filter(Boolean).join(", ") + (p.abiertos ? ((p.hogar || p.municipio) ? ". " : "") + p.abiertos + (p.abiertos > 1 ? " abiertos" : " abierto") : "") })),
        el("span", { class: "cnt" }, el("b", { text: String(p.casos.length) }), document.createTextNode(p.casos.length === 1 ? "caso" : "casos")))));
    }
    pintar();
    return out;
  }
  function vistaFicha(p) {
    const tel = normTel(p.telefono);
    const porCat = {};
    p.casos.forEach((c) => { const k = CORTO[c.categoria] || c.categoria || "Otro"; porCat[k] = (porCat[k] || 0) + 1; });
    const nota = el("textarea", { rows: 3, id: "ficha-nota", placeholder: "Lo que conviene recordar de esta persona: hogar, horarios, situación especial", "aria-label": "Nota de la ficha" });
    nota.value = p.ficha ? str(p.ficha.nota) : "";
    const box = el("section", { class: "ficha" },
      el("button", { type: "button", class: "back", html: IC.atras + "<span>Personas</span>", onclick: () => { state.persona = null; render(); } }),
      el("div", { class: "who-h" }, avatar(p.nombre, p.municipio, false), el("div", {}, el("div", { class: "nm", style: "font-family:var(--round);font-weight:800;font-size:1.25rem", text: p.nombre }), el("div", { class: "ctx", text: [p.hogar, p.municipio].filter(Boolean).join(", ") || "Sin hogar registrado" }))),
      tel ? el("div", { class: "quick" }, el("a", { href: "tel:+" + tel, html: IC.tel + "<span>Llamar</span>" }), conIcono("", IC.wa, "WhatsApp", () => abrirUrl(waUrl(tel, "")))) : el("p", { class: "sub", text: "Sin número guardado todavía." }),
      el("div", { class: "tags" }, ...Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => el("span", { class: "tag", text: k + ": " + n }))),
      el("p", { class: "lbl", text: "Nota de la ficha" }), nota,
      el("button", { type: "button", class: "btn primary", text: "Guardar nota", onclick: () => {
        const op = { k: "ficha", datos: { persona: p.nombre, telefono: p.telefono, hogar: p.hogar, municipio: p.municipio, nota: nota.value.trim() } };
        aplicarLocal(op); encolar(op); toast("Nota guardada");
      } }),
    );
    const hist = el("div", { class: "list hist" });
    [...p.casos].sort((a, b) => t(b.recibido) - t(a.recibido)).forEach((c) => {
      const inner = el("div", { class: "inner" });
      parseDocs(c).forEach((d) => inner.append(tarjetaDoc(d)));
      if (c.mensaje) inner.append(el("p", { class: "lbl", text: c.origen === "Audio" ? "Transcripción" : "Mensaje" }), el("p", { text: str(c.mensaje).split("\n").filter((l) => !l.trim().startsWith("📎")).join("\n") }));
      if (c.respuesta) inner.append(el("p", { class: "lbl", text: "Respuesta" }), el("p", { text: str(c.respuesta) }));
      if (c.nota) inner.append(el("p", { class: "lbl", text: "Nota" }), el("p", { text: str(c.nota) }));
      inner.append(el("button", { type: "button", class: "btn small", text: "Abrir el caso", onclick: () => { state.vista = "bandeja"; state.tab = c.estado === "Aprobado" ? "ready" : CERRADOS.includes(c.estado) ? "closed" : "pend"; state.persona = null; abrirDetalle(c.id); } }));
      hist.append(el("details", { class: "h" }, el("summary", {}, el("span", { class: "s1", text: str(c.resumen) }), el("span", { class: "s2", text: [c.recibido ? fmtCorta.format(new Date(c.recibido)) : "", CORTO[c.categoria] || c.categoria || "", c.estado].filter(Boolean).join(", ") })), inner));
    });
    return [box, el("p", { class: "ptitle", text: "Historial (" + p.casos.length + ")" }), p.casos.length ? hist : el("div", { class: "empty", text: "Sin casos registrados." })];
  }

  // ---------- vista: panel ----------
  function vistaPanel(all) {
    const p = partes(new Date());
    const inicio = state.periodo === "semana" ? t(isoBogota(p.y, p.m, p.d - ((p.wd + 6) % 7), 0, 0)) : state.periodo === "mes" ? t(isoBogota(p.y, p.m, 1, 0, 0)) : 0;
    const casos = all.filter((c) => t(c.recibido) >= inicio);
    const audios = casos.reduce((s, c) => s + Math.max((str(c.mensaje).match(/audio (de )?\d+:\d{2}/gi) || []).length, c.origen === "Audio" ? 1 : 0), 0);
    const docs = casos.reduce((s, c) => s + parseDocs(c).length, 0);
    const enviados = casos.reduce((s, c) => s + (c.respuesta_enviada ? 1 : 0) + (Array.isArray(c.reenvios) ? c.reenvios.filter((r) => r.enviar && r.enviado).length : 0), 0);
    const tiempos = casos.filter((c) => c.enviado && c.recibido).map((c) => t(c.enviado) - t(c.recibido)).filter((x) => x > 0).sort((a, b) => a - b);
    const mediana = tiempos.length ? tiempos[Math.floor(tiempos.length / 2)] : null;
    const cerrados = casos.filter((c) => c.estado === "Enviado" || c.estado === "Resuelto");
    const mismoDia = cerrados.filter((c) => { const fin = c.enviado || c.actualizado; return fin && dayKey(new Date(fin)) === dayKey(new Date(c.recibido)); }).length;
    const pendientes = all.filter((c) => c.estado === "Pendiente" || c.estado === "Aprobado").length;
    const contar = (f) => { const m = {}; casos.forEach((c) => { const k = f(c); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const barras = (pares) => { const max = Math.max(1, ...pares.map((x) => x[1])); return el("div", { class: "bars" }, ...pares.map(([k, n]) => el("div", { class: "bar" }, el("span", { class: "k", text: k, title: k }), el("span", { class: "tr" }, el("span", { class: "fl", style: "width:" + Math.round((n / max) * 100) + "%" })), el("span", { class: "v", text: String(n) })))); };
    const seg = el("div", { class: "seg", role: "tablist", "aria-label": "Periodo" });
    [["semana", "Esta semana"], ["mes", "Este mes"], ["todo", "Todo"]].forEach(([k, l]) => seg.append(el("button", { type: "button", role: "tab", "aria-selected": String(state.periodo === k), text: l, onclick: () => { state.periodo = k; render(); } })));
    const tile = (v, l) => el("div", { class: "tile" }, el("b", { text: v }), el("span", { text: l }));
    const fmtDur = (ms) => ms == null ? "—" : ms < 3600000 ? Math.max(1, Math.round(ms / 60000)) + " min" : ms < 172800000 ? (Math.round(ms / 360000) / 10).toString().replace(".", ",") + " h" : Math.round(ms / 86400000) + " días";
    const out = [seg,
      el("div", { class: "tiles" },
        tile(String(casos.length), "casos recibidos"),
        tile(String(pendientes), "abiertos ahora"),
        tile(fmtDur(mediana), "tiempo de respuesta (mediana)"),
        tile(cerrados.length ? Math.round((mismoDia / cerrados.length) * 100) + "%" : "—", "cerrados el mismo día"),
        tile(String(audios), "notas de voz transcritas"),
        tile(String(docs || enviados), docs ? "documentos leídos" : "mensajes enviados"))];
    if (!casos.length) { out.push(el("div", { class: "empty" }, el("strong", { text: "Sin casos en este periodo." }))); return out; }
    out.push(el("div", { class: "box" }, el("p", { class: "lbl", text: "Casos por categoría" }), barras(contar((c) => CORTO[c.categoria] || c.categoria || "Sin categoría"))));
    out.push(el("div", { class: "box" }, el("p", { class: "lbl", text: "Casos por municipio" }), barras(contar((c) => c.municipio || "Sin municipio"))));
    const sst = casos.filter((c) => c.categoria === "SST (accidente o salud)").sort((a, b) => t(b.recibido) - t(a.recibido));
    const box = el("div", { class: "box" }, el("p", { class: "lbl", text: "Salud y accidentes (" + sst.length + ")" }));
    if (!sst.length) box.append(el("p", { class: "sub", text: "Sin casos de SST en este periodo." }));
    sst.forEach((c) => {
      const rep = (c.reenvios || []).some((r) => /sst|jenny/i.test(str(r.para)) && r.enviar && r.enviado);
      const ofrecido = (c.reenvios || []).some((r) => /sst|jenny/i.test(str(r.para)) && r.enviar);
      const chip = c.prioridad === "Urgente" ? (rep ? ["grn", "Reportado a SST"] : ["red", "Falta reportar a SST"]) : (rep ? ["grn", "Informado a SST"] : ofrecido ? ["yel", "Falta informar a SST"] : ["", "Seguimiento de salud"]);
      box.append(el("div", { class: "sst-row" },
        el("span", {}, el("b", { text: str(c.persona || c.chat) }), document.createTextNode(lugar(c) ? ", " + lugar(c) : "")),
        el("span", { class: "tag " + chip[0], text: chip[1] }),
        el("span", { class: "sub", text: (c.recibido ? fmtCorta.format(new Date(c.recibido)) : "") + (c.plazo_sst ? ". Plazo ARL " + fmtCorta.format(new Date(c.plazo_sst + "T12:00:00-05:00")) : "") })));
    });
    out.push(box, el("p", { class: "sub", text: "Datos de la bitácora. Se actualizan con cada revisión." }));
    return out;
  }

  // ---------- render ----------
  function renderSafe() {
    const a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "search")) && ($("view").contains(a) || $("sheet-root").contains(a))) { state.pendingRender = true; updateChrome(); return; }
    render();
  }
  const TITULOS = { bandeja: "Bandeja", seguimiento: "Seguimiento", personas: "Personas", panel: "Panel" };
  function updateChrome() {
    const all = [...state.cases.values()];
    const pend = all.filter((c) => enTab(c, "pend")).length;
    const venc = all.filter(segVencido).length;
    const b1 = $("b-bandeja"), b2 = $("b-seguimiento");
    b1.hidden = !pend; b1.textContent = pend > 99 ? "99+" : String(pend);
    b2.hidden = !venc; b2.textContent = String(venc);
    document.querySelectorAll("#tabbar button").forEach((b) => { if (b.dataset.view === state.vista) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("titulo").textContent = TITULOS[state.vista] || "Bandeja";
    const off = $("offline");
    const pg = outbox.length;
    off.hidden = !state.offline && !pg;
    if (!off.hidden) off.textContent = (state.offline ? "Sin conexión con la hoja. " : "") + (pg ? (pg === 1 ? "1 cambio se guardará" : pg + " cambios se guardarán") + " cuando vuelva la señal." : "Mostrando lo último guardado.");
    const last = $("last");
    last.replaceChildren();
    if (state.estado && state.estado.ultima_revision) last.append(document.createTextNode("Revisado "), el("b", { text: when(state.estado.ultima_revision).toLowerCase() }));
    else last.append(document.createTextNode("Sin revisiones todavía"));
    try { if (navigator.setAppBadge) (pend ? navigator.setAppBadge(pend) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {}
    renderInstall();
  }
  function render() {
    state.pendingRender = false;
    const all = [...state.cases.values()];
    const focusedId = document.activeElement && document.activeElement.id;
    const selStart = document.activeElement && document.activeElement.selectionStart;
    let nodos, barra = null;
    if (state.detalle && !state.cases.has(state.detalle)) state.detalle = null;
    if (state.detalle) { const r = vistaDetalle(state.cases.get(state.detalle)); nodos = r.nodos; barra = r.barra; }
    else {
      const v = state.vista;
      nodos = v === "seguimiento" ? vistaSeguimiento(all) : v === "personas" ? vistaPersonas(all) : v === "panel" ? vistaPanel(all) : vistaBandeja(all);
    }
    document.body.classList.toggle("detail-open", !!state.detalle);
    $("view").replaceChildren(...nodos);
    $("actbar-root").replaceChildren(...(barra ? [barra] : []));
    barraSeleccion();
    updateChrome();
    if (focusedId) { const f = document.getElementById(focusedId); if (f && (f.tagName === "TEXTAREA" || f.tagName === "INPUT")) { f.focus(); try { const n = selStart != null ? selStart : f.value.length; f.setSelectionRange(n, n); } catch (e) {} } }
  }

  // ---------- instalar ----------
  function renderInstall() {
    const b = $("install");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (standalone || store.get(K.install) === "no" || state.vista !== "bandeja" || state.detalle) { b.hidden = true; return; }
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!state.installEvt && !ios && !MOVIL) { b.hidden = true; return; }
    b.hidden = false;
    const cerrar = el("button", { type: "button", class: "link", text: "Ocultar", onclick: () => { store.set(K.install, "no"); b.hidden = true; } });
    if (state.installEvt) b.replaceChildren(el("span", { text: "Instala la bandeja en tu celular." }), el("span", {}, el("button", { type: "button", class: "btn primary small", text: "Instalar", onclick: async () => { const e = state.installEvt; state.installEvt = null; e.prompt(); try { await e.userChoice; } catch (x) {} renderInstall(); } }), cerrar));
    else b.replaceChildren(el("span", { text: ios ? "Para tenerla como app: en Safari toca Compartir y luego «Agregar a inicio»." : "Para tenerla como app: abre el menú de Chrome y toca «Agregar a la pantalla principal»." }), cerrar);
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installEvt = e; renderInstall(); });

  // ---------- configuración ----------
  function leerHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const u = h.get("puente"), c = h.get("clave");
    if (u && c) { cfg = { url: u, clave: c }; store.set(K.cfg, cfg); history.replaceState(null, "", location.pathname + location.search); return true; }
    return false;
  }
  window.addEventListener("hashchange", () => { if (leerHash()) { mostrarMain(); render(); sync(); } });
  function mostrarConfig(err) {
    $("main").hidden = true; $("tabbar").hidden = true; $("setup").hidden = false;
    $("cfg-url").value = cfg ? cfg.url : ""; $("cfg-key").value = cfg ? cfg.clave : "";
    $("cfg-err").hidden = !err; $("cfg-err").textContent = err || "";
    $("cfg-cancel").hidden = !cfg || !!err;
  }
  function mostrarMain() { $("setup").hidden = true; $("main").hidden = false; $("tabbar").hidden = false; }
  $("cfg-save").addEventListener("click", async () => {
    let url = $("cfg-url").value.trim(), clave = $("cfg-key").value.trim();
    const m = url.match(/#.*puente=([^&]+).*clave=([^&]+)/);
    if (m) { url = decodeURIComponent(m[1]); clave = clave || decodeURIComponent(m[2]); }
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { $("cfg-err").hidden = false; $("cfg-err").textContent = "El enlace debe ser el de la aplicación web de Apps Script (https://script.google.com/…)."; return; }
    if (!clave) { $("cfg-err").hidden = false; $("cfg-err").textContent = "Falta la clave."; return; }
    const prev = cfg;
    cfg = { url, clave };
    $("cfg-save").disabled = true; $("cfg-save").textContent = "Conectando…";
    try { await api({ accion: "listar" }); store.set(K.cfg, cfg); mostrarMain(); render(); sync(); }
    catch (e) { cfg = prev; $("cfg-err").hidden = false; $("cfg-err").textContent = e.code === "clave" ? "La clave no es correcta." : "No pude conectarme al puente. Revisa el enlace y la conexión."; }
    finally { $("cfg-save").disabled = false; $("cfg-save").textContent = "Conectar"; }
  });
  $("cfg-cancel").addEventListener("click", () => mostrarMain());
  $("btn-settings").addEventListener("click", () => mostrarConfig());
  $("btn-refresh").addEventListener("click", () => sync(true));
  document.querySelectorAll("#tabbar button").forEach((b) => b.addEventListener("click", () => {
    if (state.vista === b.dataset.view && b.dataset.view === "personas") state.persona = null;
    state.vista = b.dataset.view; store.set(K.vista, state.vista); state.sel = null;
    render(); window.scrollTo({ top: 0 });
  }));
  document.addEventListener("focusout", () => setTimeout(() => { if (state.pendingRender) renderSafe(); }, 0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    revisarEnvio();
    if (!state.lastSync || now() - state.lastSync > 30000) sync(); else renderSafe();
  });
  window.addEventListener("focus", () => revisarEnvio());
  window.addEventListener("online", () => { procesarOutbox(); sync(); });
  setInterval(() => { if (document.visibilityState === "visible") sync(); }, 90000);
  setInterval(() => { if (document.visibilityState === "visible") renderSafe(); }, 60000);

  // ---------- inicio ----------
  leerHash();
  const cache = store.get(K.cache);
  if (cache && Array.isArray(cache.casos)) {
    state.cases = new Map(cache.casos.map((c) => [c.id, c]));
    state.estado = cache.estado || {};
    state.plantillas = cache.plantillas || []; state.equipo = cache.equipo || []; state.fichas = cache.fichas || [];
    state.lastSync = cache.t || null;
  }
  if (state.vista === "bandeja") state.tab = "pend";
  window.__bandejaVersion = VERSION;
  if (!cfg) mostrarConfig();
  else { mostrarMain(); render(); sync(); revisarEnvio(); }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
