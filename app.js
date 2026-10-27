/* Bandeja HCB v2: casos de WhatsApp laboral leídos de la hoja de Google a través del puente de Apps Script.
   La app nunca envía mensajes por sí sola: abre WhatsApp con el texto aprobado y la persona lo envía. */
(() => {
  "use strict";

  const TZ = "America/Bogota";
  const K = { cfg: "bandejaHCB.cfg", cache: "bandejaHCB.cache", outbox: "bandejaHCB.outbox", envio: "bandejaHCB.envio", install: "bandejaHCB.install", vista: "bandejaHCB.vista" };
  const DEFAULT_HORARIO = ["8:50", "10:50", "12:50", "14:50", "17:50"];
  const CATS = [
    ["", "Todas"], ["SST (accidente o salud)", "SST"], ["Alimentación", "Alimentación"], ["Permiso o incapacidad", "Permisos"],
    ["Pregunta", "Preguntas"], ["Documento o RAM", "Documentos"], ["Emergencia", "Emergencias"], ["Sindical", "Sindical"], ["Informativo", "Informativo"],
  ];
  const CORTO = Object.fromEntries(CATS.filter(([v]) => v).map(([v, l]) => [v, l]));
  const PRIO = { Urgente: 0, Alta: 1, Normal: 2 };
  const CERRADOS = ["Enviado", "Resuelto", "Descartado"];
  const LIMITE_ESPERA_H = { Urgente: 1, Alta: 4, Normal: 24 };
  const MOVIL = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const WA_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/></svg>';
  const LUPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const state = {
    vista: store.get(K.vista) || "bandeja", tab: "pend", cat: "", buscar: "", buscarP: "", periodo: "mes", persona: null,
    cases: new Map(), estado: {}, plantillas: [], equipo: [], fichas: [],
    drafts: new Map(), open: new Set(), lastSync: null, syncing: false, offline: false, pendingRender: false, installEvt: null,
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

  // ---------- fechas (hora de Bogotá) ----------
  const fmtTime0 = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const fmtTime = (d) => fmtTime0.format(d).replace(/\s/g, " ");
  const fmtDate = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const fmtCorta = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "numeric", month: "short" });
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
    return Math.round(h / 24) + " días";
  }
  function nextReview() {
    const h = Array.isArray(state.estado.horario) && state.estado.horario.length ? state.estado.horario : DEFAULT_HORARIO;
    const p = partes(new Date());
    const mins = p.h * 60 + p.mi;
    const slots = h.map((x) => { const [a, b] = x.split(":").map(Number); return { m: a * 60 + (b || 0), a, b: b || 0 }; }).filter((s) => !isNaN(s.m)).sort((x, y) => x.m - y.m);
    if (!slots.length) return "";
    const label = (s) => fmtTime(new Date(Date.UTC(2026, 0, 1, s.a + 5, s.b)));
    if (p.wd >= 1 && p.wd <= 5) { const s = slots.find((x) => x.m > mins); if (s) return "hoy " + label(s); }
    return (p.wd === 5 || p.wd === 6 ? "el lunes " : "mañana ") + label(slots[0]);
  }
  function deadline(c) {
    const p = str(c.plazo_sst);
    if (!p) return null;
    const d = new Date(p + "T12:00:00-05:00");
    const label = isNaN(d) ? p : fmtDate.format(d);
    const hoy = dayKey(new Date());
    if (CERRADOS.includes(c.estado)) return "Plazo ARL: " + label;
    if (p < hoy) return "Plazo ARL vencido";
    if (p === hoy) return "Plazo ARL: hoy";
    return "Plazo ARL: " + label;
  }
  function espera(c) {
    if (CERRADOS.includes(c.estado)) return null;
    const desde = t(c.recibido);
    if (!desde) return null;
    const ms = now() - desde;
    const lim = (LIMITE_ESPERA_H[c.prioridad] || 24) * 3600000;
    return { texto: "Esperando " + hace(ms), clase: ms > lim ? "late" : ms > lim / 2 ? "warn" : "" };
  }
  const pospuesto = (c) => c.estado === "Pendiente" && t(c.pospuesto) > now();
  const recordatorio = (c) => c.estado === "Pendiente" && c.pospuesto && t(c.pospuesto) <= now();
  const segVencido = (c) => c.seguimiento && t(c.seguimiento) <= now() && c.estado !== "Descartado";
  const segFuturo = (c) => c.seguimiento && t(c.seguimiento) > now() && c.estado !== "Descartado";

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
  function primerNombre(c) {
    const p = str(c.persona || c.destinatario).trim().split(/\s+/)[0] || "";
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
  }
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
            for (const later of outbox.slice(1)) if (later.k === "caso" && later.id === op.id) caso = applyCambios(caso, later.cambios);
            state.cases.set(op.id, caso);
          }
          outbox.shift(); store.set(K.outbox, outbox); persistCache();
        } catch (e) {
          if (["no_existe", "estado", "id", "falta_nombre", "accion"].includes(e.code)) { outbox.shift(); store.set(K.outbox, outbox); continue; }
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
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (tt.hidden = true), undo ? 5000 : 2600);
  }
  function elegirMomento(titulo, ayuda, alElegir) {
    const p = partes(new Date());
    const opciones = [
      ["En 3 horas", new Date(now() + 3 * 3600000).toISOString()],
      ["Mañana a las 8:00 a. m.", diaHabil(1)],
      ["En 2 días, 8:00 a. m.", diaHabil(2)],
      ["En una semana", diaHabil(7)],
    ];
    if (p.wd === 5) opciones[1][0] = "El lunes a las 8:00 a. m.";
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

  // ---------- acciones sobre casos ----------
  function draftFor(c) {
    if (!state.drafts.has(c.id)) {
      const opts = Array.isArray(c.opciones) ? c.opciones.map(str) : [];
      const fwd = (Array.isArray(c.reenvios) ? c.reenvios : []).map((r) => ({ para: str(r.para), telefono: str(r.telefono), texto: str(r.texto), enviar: r.enviar !== false, edit: false }));
      const resp = str(c.respuesta);
      state.drafts.set(c.id, {
        sel: resp ? (opts.indexOf(resp) >= 0 ? opts.indexOf(resp) : -2) : opts.length ? 0 : -1,
        text: resp || opts[0] || "", editing: !!resp && opts.indexOf(resp) < 0,
        fwd, nota: str(c.nota), showNote: !!c.nota,
      });
    }
    return state.drafts.get(c.id);
  }
  function aprobarYEnviar(c) {
    const d = draftFor(c);
    const texto = d.text.trim();
    const reenvios = d.fwd.map((r) => ({ para: r.para, telefono: r.telefono, texto: r.texto.trim(), enviar: !!r.enviar, enviado: false }));
    if (c.destinatario && !texto) { toast("Elige o escribe una respuesta."); return; }
    if (!texto && !reenvios.some((r) => r.enviar && r.texto)) { toast("No hay nada para enviar."); return; }
    if (/\[[^\]]+\]/.test(texto)) { toast("Completa lo que está entre corchetes, por ejemplo [fecha]."); return; }
    state.drafts.delete(c.id);
    queue(c.id, { estado: "Aprobado", respuesta: texto, reenvios, nota: d.nota.trim(), aprobado: true, respuesta_enviada: false, pospuesto: "" });
    const env = enviosDe(state.cases.get(c.id)).find((e) => !e.enviado);
    buzz();
    if (env) abrirWhatsApp(c.id, env);
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
  function posponer(c) {
    elegirMomento("¿Cuándo te lo recuerdo?", "El caso sale de Pendientes y vuelve a aparecer a esa hora.", (iso) => {
      queue(c.id, { pospuesto: iso });
      toast("Pospuesto hasta " + when(iso).toLowerCase(), () => queue(c.id, { pospuesto: "" }));
    });
  }
  function programarSeguimiento(c, despues) {
    elegirMomento("¿Cuándo reviso si respondió?", "Si " + (primerNombre(c) || "la persona") + " no ha respondido, el caso aparece en Seguimiento.", (iso) => {
      queue(c.id, { seguimiento: iso });
      toast("Te recuerdo " + when(iso).toLowerCase());
      if (despues) despues();
    });
  }
  function preguntarSeguimiento(c) {
    if (!c || !c.destinatario) { toast("Caso enviado ✓"); return; }
    abrirHoja(
      el("h2", { text: "Caso enviado ✓" }),
      el("p", { text: "¿Te recuerdo revisar si " + (primerNombre(c) || "la persona") + " respondió?" }),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn", text: "Mañana a las 8:00 a. m.", onclick: () => { cerrarHoja(); queue(c.id, { seguimiento: diaHabil(1) }); toast("Listo, te recuerdo mañana"); } }),
        el("button", { type: "button", class: "btn", text: "Elegir otro momento", onclick: () => { cerrarHoja(); programarSeguimiento(c); } }),
        el("button", { type: "button", class: "btn quiet", text: "No hace falta", onclick: cerrarHoja })),
    );
  }
  function pasarCaso(c) {
    const fecha = c.recibido ? fmtCorta.format(new Date(c.recibido)) : "";
    let elegido = null;
    const ta = el("textarea", { rows: 6, "aria-label": "Mensaje para el compañero" });
    const armar = (nombre) => {
      const lineas = ["Hola" + (nombre ? " " + nombre.split(" ")[0] : "") + ", te paso este caso de " + (c.persona || c.chat) + ([c.hogar, c.municipio].filter(Boolean).length ? " (" + [c.hogar, c.municipio].filter(Boolean).join(", ") + ")" : "") + (fecha ? ", recibido el " + fecha : "") + ":", str(c.resumen)];
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
        el("button", { type: "button", class: "btn wa", html: WA_ICON + "<span>Abrir WhatsApp</span>", onclick: () => {
          const texto = ta.value.trim(); if (!texto) return;
          const quien = elegido ? elegido.nombre : "un compañero";
          if (!elegido || !normTel(elegido.telefono)) copiar(texto);
          abrirUrl(waUrl(elegido ? elegido.telefono : "", texto));
          const nota = [str(c.nota).trim(), "Pasado a " + quien + " el " + fmtCorta.format(new Date())].filter(Boolean).join("\n");
          queue(c.id, { asignado: quien, nota });
          cerrarHoja();
        } }),
        el("button", { type: "button", class: "btn quiet", text: "Cancelar", onclick: cerrarHoja })),
    );
  }
  function elegirPlantilla(c, d) {
    const lista = plantillasPara(c);
    abrirHoja(
      el("h2", { text: "Respuestas guardadas" }),
      lista.length ? el("p", { text: "Se llenan solas con el nombre y el hogar. Lo que quede entre corchetes lo completas tú." }) : el("p", { text: "Aún no hay plantillas. Escribe una respuesta y toca «Guardar como plantilla», o agrégalas en la pestaña Plantillas de la hoja." }),
      el("div", { class: "btns" }, ...lista.map((p) => el("button", { type: "button", class: "tpl", onclick: () => {
        d.sel = -2; d.text = rellenar(p.texto, c); d.editing = true; cerrarHoja(); render();
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
        el("button", { type: "button", class: "btn primary", text: "Guardar", onclick: () => {
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
        el("button", { type: "button", class: "btn primary", text: "Sí, se envió", onclick: () => { store.del(K.envio); cerrarHoja(); siguiente(marcarEnviado(c.id, env.key)); } }),
        el("button", { type: "button", class: "btn", html: WA_ICON + "<span>Abrir WhatsApp otra vez</span>", onclick: () => { cerrarHoja(); abrirWhatsApp(c.id, env); } }),
        el("button", { type: "button", class: "btn quiet", text: "No, lo envío después", onclick: () => { store.del(K.envio); cerrarHoja(); } })),
    );
  }
  function siguiente(c) {
    if (!c) return;
    const env = enviosDe(c).find((e) => !e.enviado);
    if (!env) { preguntarSeguimiento(c); return; }
    abrirHoja(
      el("h2", { text: "Falta enviar a " + env.para }),
      el("p", { text: env.texto.length > 160 ? env.texto.slice(0, 160) + "…" : env.texto }),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn wa", html: WA_ICON + "<span>Abrir WhatsApp</span>", onclick: () => { cerrarHoja(); abrirWhatsApp(c.id, env); } }),
        el("button", { type: "button", class: "btn quiet", text: "Más tarde", onclick: cerrarHoja })),
    );
  }

  // ---------- tarjetas ----------
  function detailsBlock(c) {
    const key = "d-" + c.id;
    const det = el("details", { open: state.open.has(key) || undefined });
    det.addEventListener("toggle", () => { det.open ? state.open.add(key) : state.open.delete(key); });
    const inner = el("div", { class: "inner" });
    if (c.mensaje) inner.append(el("p", { class: "lbl", text: c.origen === "Audio" ? "Transcripción del audio" : "Mensaje" }), el("p", { text: str(c.mensaje) }));
    if (c.accion) inner.append(el("p", { class: "lbl", text: "Qué hacer" }), el("p", { text: str(c.accion) }));
    det.append(el("summary", { text: c.origen === "Audio" ? "Audio transcrito y qué hacer" : "Mensaje y qué hacer" }), inner);
    return det;
  }
  function cabecera(c, body) {
    const tel = normTel(c.telefono);
    const esp = espera(c);
    body.append(
      el("div", { class: "top" }, el("button", { type: "button", class: "who", text: str(c.persona) || str(c.chat), "aria-label": "Ver ficha de " + (c.persona || c.chat), onclick: () => abrirFicha(c.persona || c.chat) }), el("span", { class: "time", text: when(c.recibido) })),
      el("div", { class: "where" },
        el("span", { text: [c.chat && c.chat !== c.persona ? "en " + str(c.chat) : "", str(c.hogar), str(c.municipio)].filter(Boolean).join(" · ") }),
        tel ? el("a", { href: "tel:+" + tel, text: "Llamar" }) : null),
      el("div", { class: "pills" },
        el("span", { class: "pill cat", text: str(c.categoria) || "Sin categoría" }),
        c.prioridad && c.prioridad !== "Normal" ? el("span", { class: "pill prio-" + c.prioridad, text: str(c.prioridad) }) : null,
        c.origen === "Audio" ? el("span", { class: "pill", text: "Audio" }) : null,
        deadline(c) ? el("span", { class: "pill deadline", text: deadline(c) }) : null,
        esp ? el("span", { class: "pill " + esp.clase, text: esp.texto }) : null,
        recordatorio(c) ? el("span", { class: "pill warn", text: "Recordatorio" }) : null,
        c.asignado ? el("span", { class: "pill", text: "Pasado a " + c.asignado }) : null,
        c.estado !== "Pendiente" ? el("span", { class: "pill state", text: c.estado === "Aprobado" ? "Por enviar" : str(c.estado) }) : null),
      el("p", { class: "summary", text: str(c.resumen) }),
    );
    if (c.mensaje || c.accion) body.append(detailsBlock(c));
  }
  function tarjetaPendiente(c, body) {
    const d = draftFor(c);
    const opts = Array.isArray(c.opciones) ? c.opciones.map(str) : [];
    if (c.destinatario) {
      body.append(el("p", { class: "lbl", text: "Responder a " + str(c.destinatario) }));
      const box = el("div", { class: "options", role: "group", "aria-label": "Opciones de respuesta" });
      opts.forEach((o, i) => box.append(el("button", { type: "button", class: "opt", "aria-pressed": String(d.sel === i), text: o, onclick: () => { d.sel = i; d.text = o; d.editing = false; render(); } })));
      box.append(el("button", { type: "button", class: "opt own", "aria-pressed": String(d.sel < 0), text: d.sel < 0 ? "Mi propia respuesta" : "Escribir mi propia respuesta",
        onclick: () => { if (d.sel >= 0) { d.sel = -1; d.text = ""; } d.editing = true; render(); const x = $("resp-" + c.id); if (x) x.focus(); } }));
      body.append(box);
      const links = el("div", { class: "links" });
      if (d.editing || d.sel < 0) {
        const ta = el("textarea", { id: "resp-" + c.id, "aria-label": "Texto de la respuesta", rows: 4, placeholder: "Escribe la respuesta como la enviarías" });
        ta.value = d.text;
        ta.addEventListener("input", () => { d.text = ta.value; if (d.sel >= 0) d.sel = -2; });
        body.append(ta);
      } else if (opts.length) links.append(el("button", { type: "button", class: "link", text: "Editar el texto", onclick: () => { d.editing = true; render(); const x = $("resp-" + c.id); if (x) x.focus(); } }));
      links.append(el("button", { type: "button", class: "link", text: "Usar plantilla", onclick: () => elegirPlantilla(c, d) }));
      if (d.editing || d.sel < 0) links.append(el("button", { type: "button", class: "link", text: "Guardar como plantilla", onclick: () => guardarPlantilla(c, d.text) }));
      body.append(links);
    }
    d.fwd.forEach((r, i) => {
      const cb = el("input", { type: "checkbox", id: "fwd-" + c.id + "-" + i, role: "switch" });
      cb.checked = r.enviar;
      cb.addEventListener("change", () => { r.enviar = cb.checked; render(); });
      const fwd = el("div", { class: "fwd" }, el("label", { class: "switch", for: cb.id }, el("span", {}, document.createTextNode("Enviar también a " + r.para), el("span", { class: "num", text: r.telefono || "sin número" })), cb));
      if (r.enviar) {
        if (r.edit) { const x = el("textarea", { id: "fwdt-" + c.id + "-" + i, rows: 5, "aria-label": "Mensaje para " + r.para }); x.value = r.texto; x.addEventListener("input", () => { r.texto = x.value; }); fwd.append(x); }
        else fwd.append(el("button", { type: "button", class: "link", text: "Ver o editar el mensaje", onclick: () => { r.edit = true; render(); } }));
      }
      body.append(fwd);
    });
    if (d.showNote) {
      const note = el("textarea", { id: "nota-" + c.id, rows: 2, placeholder: "Nota para la bitácora", "aria-label": "Nota" });
      note.style.minHeight = "64px"; note.value = d.nota; note.addEventListener("input", () => { d.nota = note.value; });
      body.append(note);
    } else body.append(el("button", { type: "button", class: "link", text: "+ Agregar una nota", onclick: () => { d.showNote = true; render(); const n = $("nota-" + c.id); if (n) n.focus(); } }));

    const hayEnvio = !!c.destinatario || d.fwd.some((r) => r.enviar);
    const actions = el("div", { class: "actions" });
    if (hayEnvio) actions.append(el("button", { type: "button", class: "btn wa full", html: WA_ICON + "<span>Aprobar y enviar por WhatsApp</span>", onclick: () => aprobarYEnviar(c) }));
    actions.append(
      el("button", { type: "button", class: "btn small", text: "Ya lo resolví", onclick: () => { const nota = d.nota.trim(); state.drafts.delete(c.id); queue(c.id, { estado: "Resuelto", nota, pospuesto: "" }); toast("Marcado como resuelto", () => queue(c.id, { estado: "Pendiente" })); } }),
      el("button", { type: "button", class: "btn small", text: "Posponer", onclick: () => posponer(c) }),
      el("button", { type: "button", class: "btn small", text: "Pasar a compañero", onclick: () => pasarCaso(c) }),
      el("button", { type: "button", class: "btn small quiet", text: "Descartar", onclick: () => { state.drafts.delete(c.id); queue(c.id, { estado: "Descartado", pospuesto: "" }); toast("Caso descartado", () => queue(c.id, { estado: "Pendiente" })); } }),
    );
    body.append(actions);
    if (hayEnvio && c.destinatario && !normTel(c.telefono)) body.append(el("p", { class: "sub", text: "Sin número guardado: WhatsApp te pedirá elegir el chat y el texto queda copiado." }));
  }
  function tarjetaPorEnviar(c, body) {
    const list = el("div", { class: "send-list" });
    enviosDe(c).forEach((env) => {
      const item = el("div", { class: "send-item" },
        el("div", { class: "row" }, el("span", { class: "who2", text: (env.key === "r" ? "Respuesta a " : "Para ") + env.para }), el("span", { class: "st" + (env.enviado ? " done" : ""), text: env.enviado ? "Enviado" : "Falta enviar" })),
        el("div", { class: "txt", text: env.texto }));
      if (!env.enviado) item.append(el("div", { class: "btns" },
        el("button", { type: "button", class: "btn wa", html: WA_ICON + "<span>Abrir</span>", onclick: () => abrirWhatsApp(c.id, env) }),
        el("button", { type: "button", class: "btn", text: "Ya lo envié", onclick: () => { const n = marcarEnviado(c.id, env.key); if (n && n.estado === "Enviado") preguntarSeguimiento(n); } })));
      list.append(item);
    });
    body.append(el("p", { class: "lbl", text: "Mensajes aprobados" }), list,
      el("div", { class: "actions" },
        el("button", { type: "button", class: "btn small", text: "Pasar a compañero", onclick: () => pasarCaso(c) }),
        el("button", { type: "button", class: "btn small quiet", text: "Volver a pendiente", onclick: () => { queue(c.id, { estado: "Pendiente" }); toast("Volvió a pendientes"); } })));
  }
  function tarjetaCerrada(c, body) {
    if (c.respuesta) body.append(el("p", { class: "lbl", text: (c.respuesta_enviada || c.estado === "Enviado" ? "Enviado a " : "Respuesta para ") + str(c.destinatario) }), el("div", { class: "final", text: str(c.respuesta) }));
    (Array.isArray(c.reenvios) ? c.reenvios : []).filter((r) => r.enviar && r.texto).forEach((r) => body.append(el("p", { class: "lbl", text: "Para " + str(r.para) }), el("div", { class: "final", text: str(r.texto) })));
    if (c.nota) body.append(el("p", { class: "lbl", text: "Nota" }), el("p", { class: "summary", style: "font-weight:400;font-size:.92rem;white-space:pre-wrap", text: str(c.nota) }));
    if (c.estado === "Enviado" && c.enviado) body.append(el("p", { class: "sub", text: "Enviado " + when(c.enviado).toLowerCase() + (c.seguimiento ? " · seguimiento " + when(c.seguimiento).toLowerCase() : "") }));
    const acc = el("div", { class: "actions" });
    if (c.estado === "Enviado" && c.destinatario && !c.seguimiento) acc.append(el("button", { type: "button", class: "btn small", text: "Recordarme si no responde", onclick: () => programarSeguimiento(c) }));
    acc.append(el("button", { type: "button", class: "btn small", text: "Pasar a compañero", onclick: () => pasarCaso(c) }));
    if (c.estado === "Resuelto" || c.estado === "Descartado") acc.append(el("button", { type: "button", class: "btn small quiet", text: "Volver a pendiente", onclick: () => { queue(c.id, { estado: "Pendiente" }); toast("Volvió a pendientes"); } }));
    body.append(acc);
  }
  function tarjeta(c) {
    const card = el("article", { class: "card", "data-prio": str(c.prioridad) || "Normal", "aria-label": str(c.persona) + ": " + str(c.resumen) });
    const body = el("div", { class: "body" });
    card.append(el("div", { class: "stripe" }), body);
    cabecera(c, body);
    if (c.estado === "Pendiente") tarjetaPendiente(c, body);
    else if (c.estado === "Aprobado") tarjetaPorEnviar(c, body);
    else tarjetaCerrada(c, body);
    return card;
  }
  function tarjetaSeguimiento(c, vencido) {
    const card = el("article", { class: "card", "data-prio": "Normal" });
    const body = el("div", { class: "body" });
    card.append(el("div", { class: "stripe" }), body);
    body.append(
      el("div", { class: "top" }, el("button", { type: "button", class: "who", text: str(c.persona) || str(c.chat), onclick: () => abrirFicha(c.persona || c.chat) }), el("span", { class: "time", text: (vencido ? "Desde " : "") + when(c.seguimiento) })),
      el("p", { class: "summary", text: vencido ? "¿" + (primerNombre(c) || "La persona") + " ya respondió?" : str(c.resumen) }),
      ...[vencido ? el("p", { class: "sub", text: str(c.resumen) }) : null,
        c.respuesta ? el("div", { class: "final", text: "Le escribiste: " + str(c.respuesta) }) : null].filter(Boolean),
    );
    const acc = el("div", { class: "actions" });
    if (vencido) {
      acc.append(
        el("button", { type: "button", class: "btn primary full", text: "Ya respondió", onclick: () => { queue(c.id, { seguimiento: "" }); toast("Seguimiento cerrado", () => queue(c.id, { seguimiento: c.seguimiento })); } }),
        el("button", { type: "button", class: "btn wa small", html: WA_ICON + "<span>Escribirle</span>", onclick: () => escribirSeguimiento(c) }),
        el("button", { type: "button", class: "btn small", text: "Recordar después", onclick: () => programarSeguimiento(c) }));
    } else {
      acc.append(
        el("button", { type: "button", class: "btn small", text: "Cambiar fecha", onclick: () => programarSeguimiento(c) }),
        el("button", { type: "button", class: "btn small quiet", text: "Quitar", onclick: () => { queue(c.id, { seguimiento: "" }); toast("Seguimiento quitado"); } }));
    }
    body.append(acc);
    return card;
  }
  function escribirSeguimiento(c) {
    const tpl = state.plantillas.find((p) => /seguimiento/i.test(p.nombre));
    const ta = el("textarea", { rows: 4, "aria-label": "Mensaje de seguimiento" });
    ta.value = rellenar(tpl ? tpl.texto : "Hola profe, ¿cómo va {tema}? Quedo atento.", c);
    abrirHoja(
      el("h2", { text: "Escribirle a " + (primerNombre(c) || "la persona") }), ta,
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn wa", html: WA_ICON + "<span>Abrir WhatsApp</span>", onclick: () => {
          const texto = ta.value.trim(); if (!texto) return;
          if (/\[[^\]]+\]/.test(texto)) { toast("Completa lo que está entre corchetes."); return; }
          if (!normTel(c.telefono)) copiar(texto);
          abrirUrl(waUrl(c.telefono, texto));
          queue(c.id, { seguimiento: diaHabil(1), nota: [str(c.nota).trim(), "Seguimiento enviado el " + fmtCorta.format(new Date())].filter(Boolean).join("\n") });
          cerrarHoja(); toast("Te recuerdo mañana si sigue sin responder");
        } }),
        el("button", { type: "button", class: "btn quiet", text: "Cancelar", onclick: cerrarHoja })),
    );
  }

  // ---------- vistas ----------
  function filtrosCat(pool, onPick) {
    const f = el("div", { class: "filters", role: "group", "aria-label": "Filtrar por categoría" });
    const present = new Set(pool.map((c) => c.categoria));
    const chips = CATS.filter(([v]) => !v || present.has(v) || state.cat === v);
    if (chips.length <= 2 && !state.cat) return null;
    f.append(...chips.map(([v, label]) => el("button", { type: "button", class: "chip", "aria-pressed": String(state.cat === v), text: label, onclick: () => { state.cat = v; onPick(); } })));
    return f;
  }
  function buscador(valor, placeholder, onInput, id) {
    const inp = el("input", { type: "search", id, placeholder, "aria-label": placeholder, autocomplete: "off" });
    inp.value = valor;
    inp.addEventListener("input", () => onInput(inp.value));
    return el("div", { class: "search", html: LUPA }, inp);
  }
  const coincide = (c, q) => !q || norm([c.persona, c.chat, c.hogar, c.municipio, c.resumen, c.destinatario].join(" ")).includes(norm(q));

  function vistaBandeja(all) {
    const pend = all.filter((c) => c.estado === "Pendiente" && !pospuesto(c));
    const ready = all.filter((c) => c.estado === "Aprobado");
    const urgent = pend.filter((c) => c.prioridad === "Urgente");
    const out = [];
    if (urgent.length) out.push(el("div", { class: "banner urgent", text: urgent.length === 1 ? "1 caso urgente sin resolver" : urgent.length + " casos urgentes sin resolver" }));
    const seg = el("div", { class: "seg sticky", role: "tablist", "aria-label": "Estado de los casos" });
    [["pend", "Pendientes", pend.length], ["ready", "Por enviar", ready.length], ["closed", "Cerrados", null]].forEach(([k, l, n]) => seg.append(
      el("button", { type: "button", role: "tab", "aria-selected": String(state.tab === k), onclick: () => { state.tab = k; state.cat = ""; render(); window.scrollTo({ top: 0 }); } }, document.createTextNode(l), n !== null ? el("span", { class: "n", text: String(n) }) : null)));
    out.push(seg);
    out.push(buscador(state.buscar, "Buscar profe, hogar o municipio", (v) => { state.buscar = v; renderLista(); }, "q-bandeja"));
    const lista = el("div", { class: "list", id: "lista" });
    const filtrosHost = el("div");
    out.push(filtrosHost, lista);
    function renderLista() {
      const inTab = (c) => state.tab === "pend" ? (c.estado === "Pendiente" && !pospuesto(c)) : state.tab === "ready" ? c.estado === "Aprobado" : CERRADOS.includes(c.estado);
      const pool = all.filter(inTab).filter((c) => coincide(c, state.buscar));
      filtrosHost.replaceChildren(filtrosCat(pool, render) || "");
      const shown = pool.filter((c) => !state.cat || c.categoria === state.cat).sort((a, b) => state.tab === "closed"
        ? str(b.actualizado || b.recibido).localeCompare(str(a.actualizado || a.recibido))
        : (recordatorio(b) - recordatorio(a)) || (PRIO[a.prioridad] ?? 2) - (PRIO[b.prioridad] ?? 2) || str(a.recibido).localeCompare(str(b.recibido)));
      if (!shown.length) {
        const msg = state.buscar ? "Nada coincide con la búsqueda." : state.tab === "pend" ? (state.cat ? "No hay pendientes en esta categoría." : all.length ? "Todo al día." : (state.lastSync ? "Aún no hay casos." : "Cargando casos…"))
          : state.tab === "ready" ? "No hay mensajes esperando envío." : "Todavía no hay casos cerrados.";
        const hint = state.tab === "pend" && state.lastSync && !state.buscar ? "Después de cada revisión aparecen aquí los mensajes laborales con la acción sugerida y las respuestas para elegir." : "";
        lista.replaceChildren(el("div", { class: "empty" }, el("strong", { text: msg }), hint ? document.createTextNode(hint) : null));
      } else lista.replaceChildren(...(state.tab === "closed" ? shown.slice(0, 60) : shown).map(tarjeta));
    }
    renderLista();
    return out;
  }

  function vistaSeguimiento(all) {
    const venc = all.filter(segVencido).sort((a, b) => t(a.seguimiento) - t(b.seguimiento));
    const prox = all.filter(segFuturo).sort((a, b) => t(a.seguimiento) - t(b.seguimiento));
    const posp = all.filter(pospuesto).sort((a, b) => t(a.pospuesto) - t(b.pospuesto));
    const out = [el("h2", { class: "vt", text: "Seguimiento" })];
    if (!venc.length && !prox.length && !posp.length) {
      out.push(el("div", { class: "empty" }, el("strong", { text: "No tienes seguimientos ni casos pospuestos." }),
        document.createTextNode("Al enviar una respuesta puedes pedir que te recuerde si la persona no contesta, y en Pendientes puedes posponer un caso.")));
      return out;
    }
    if (venc.length) out.push(el("h3", { class: "st", text: "Para revisar ahora" }), el("div", { class: "list" }, ...venc.map((c) => tarjetaSeguimiento(c, true))));
    if (posp.length) out.push(el("h3", { class: "st", text: "Pospuestos" }), el("div", { class: "list" }, ...posp.map((c) => {
      const card = el("article", { class: "card", "data-prio": str(c.prioridad) || "Normal" });
      const body = el("div", { class: "body" });
      card.append(el("div", { class: "stripe" }), body);
      body.append(
        el("div", { class: "top" }, el("button", { type: "button", class: "who", text: str(c.persona) || str(c.chat), onclick: () => abrirFicha(c.persona || c.chat) }), el("span", { class: "time", text: "Vuelve " + when(c.pospuesto).toLowerCase() })),
        el("p", { class: "summary", text: str(c.resumen) }),
        el("div", { class: "actions" },
          el("button", { type: "button", class: "btn small primary", text: "Traer ahora", onclick: () => { queue(c.id, { pospuesto: "" }); state.vista = "bandeja"; state.tab = "pend"; render(); } }),
          el("button", { type: "button", class: "btn small", text: "Cambiar fecha", onclick: () => posponer(c) })));
      return card;
    })));
    if (prox.length) out.push(el("h3", { class: "st", text: "Próximos seguimientos" }), el("div", { class: "list" }, ...prox.map((c) => tarjetaSeguimiento(c, false))));
    return out;
  }

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
    const out = [el("h2", { class: "vt", text: "Personas" }),
      buscador(state.buscarP, "Buscar por nombre, hogar o municipio", (v) => { state.buscarP = v; pintar(); }, "q-personas")];
    const lista = el("div", { class: "plist" });
    out.push(lista);
    function pintar() {
      const q = norm(state.buscarP);
      const sel = gente.filter((p) => !q || norm([p.nombre, p.hogar, p.municipio].join(" ")).includes(q));
      if (!sel.length) { lista.replaceChildren(el("div", { class: "empty" }, el("strong", { text: gente.length ? "Nadie coincide con la búsqueda." : "Aún no hay personas." }))); return; }
      lista.replaceChildren(...sel.slice(0, 150).map((p) => el("button", { type: "button", class: "prow", onclick: () => abrirFicha(p.nombre) },
        el("span", { class: "nm", text: p.nombre }),
        el("span", { class: "cnt" }, el("b", { text: String(p.casos.length) }), document.createTextNode(p.casos.length === 1 ? "caso" : "casos")),
        el("span", { class: "mt", text: [p.hogar, p.municipio].filter(Boolean).join(" · ") + (p.abiertos ? (p.hogar || p.municipio ? " · " : "") + p.abiertos + " abierto" + (p.abiertos > 1 ? "s" : "") : "") }))));
    }
    pintar();
    return out;
  }
  function vistaFicha(p) {
    const tel = normTel(p.telefono);
    const box = el("section", { class: "ficha" });
    const porCat = {};
    p.casos.forEach((c) => { const k = CORTO[c.categoria] || c.categoria || "Otro"; porCat[k] = (porCat[k] || 0) + 1; });
    const nota = el("textarea", { rows: 3, id: "ficha-nota", placeholder: "Lo que conviene recordar de esta persona (por ejemplo: hogar, horarios, situación especial)", "aria-label": "Nota de la ficha" });
    nota.value = p.ficha ? str(p.ficha.nota) : "";
    box.append(
      el("button", { type: "button", class: "link", text: "← Volver a Personas", onclick: () => { state.persona = null; render(); } }),
      el("h2", { text: p.nombre }),
      el("p", { class: "sub", text: [p.hogar, p.municipio].filter(Boolean).join(" · ") || "Sin hogar registrado" }),
      tel ? el("div", { class: "actions" },
        el("a", { class: "btn", href: "tel:+" + tel, text: "Llamar" }),
        el("button", { type: "button", class: "btn wa small", html: WA_ICON + "<span>WhatsApp</span>", onclick: () => abrirUrl(waUrl(tel, "")) })) : el("p", { class: "sub", text: "Sin número guardado todavía." }),
      el("div", { class: "pills" }, ...Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => el("span", { class: "pill cat", text: k + ": " + n }))),
      el("p", { class: "lbl", text: "Nota de la ficha" }), nota,
      el("button", { type: "button", class: "btn primary", text: "Guardar nota", onclick: () => {
        const op = { k: "ficha", datos: { persona: p.nombre, telefono: p.telefono, hogar: p.hogar, municipio: p.municipio, nota: nota.value.trim() } };
        aplicarLocal(op); encolar(op); toast("Nota guardada");
      } }),
    );
    const hist = el("div", { class: "hist" });
    [...p.casos].sort((a, b) => t(b.recibido) - t(a.recibido)).forEach((c) => {
      const inner = el("div", { class: "inner" });
      if (c.mensaje) inner.append(el("p", { class: "lbl", text: c.origen === "Audio" ? "Transcripción" : "Mensaje" }), el("p", { text: str(c.mensaje) }));
      if (c.respuesta) inner.append(el("p", { class: "lbl", text: "Respuesta" }), el("p", { text: str(c.respuesta) }));
      if (c.nota) inner.append(el("p", { class: "lbl", text: "Nota" }), el("p", { text: str(c.nota) }));
      if (!CERRADOS.includes(c.estado)) inner.append(el("button", { type: "button", class: "btn small", text: "Abrir en la bandeja", onclick: () => { state.vista = "bandeja"; state.tab = c.estado === "Aprobado" ? "ready" : "pend"; state.buscar = p.nombre; state.cat = ""; render(); } }));
      hist.append(el("details", {}, el("summary", {}, el("span", { text: str(c.resumen) }), el("span", { class: "d", text: (c.recibido ? fmtCorta.format(new Date(c.recibido)) : "") + " · " + (CORTO[c.categoria] || c.categoria || "") + " · " + c.estado })), inner));
    });
    return [box, el("h3", { class: "st", text: "Historial (" + p.casos.length + ")" }), p.casos.length ? hist : el("div", { class: "empty", text: "Sin casos registrados." })];
  }

  function vistaPanel(all) {
    const p = partes(new Date());
    const inicio = state.periodo === "semana" ? t(isoBogota(p.y, p.m, p.d - ((p.wd + 6) % 7), 0, 0)) : state.periodo === "mes" ? t(isoBogota(p.y, p.m, 1, 0, 0)) : 0;
    const casos = all.filter((c) => t(c.recibido) >= inicio);
    const audios = casos.reduce((s, c) => s + Math.max((str(c.mensaje).match(/audio de \d+:\d{2}/gi) || []).length, c.origen === "Audio" ? 1 : 0), 0);
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
    const out = [el("h2", { class: "vt", text: "Panel de resultados" }), seg,
      el("div", { class: "tiles" },
        tile(String(casos.length), "casos recibidos"),
        tile(String(audios), "notas de voz transcritas"),
        tile(String(enviados), "mensajes enviados"),
        tile(fmtDur(mediana), "tiempo de respuesta (mediana)"),
        tile(cerrados.length ? Math.round((mismoDia / cerrados.length) * 100) + "%" : "—", "cerrados el mismo día"),
        tile(String(pendientes), "abiertos ahora (todos)"))];
    if (!casos.length) { out.push(el("div", { class: "empty" }, el("strong", { text: "Sin casos en este periodo." }))); return out; }
    out.push(el("div", { class: "box" }, el("p", { class: "lbl", text: "Casos por categoría" }), barras(contar((c) => CORTO[c.categoria] || c.categoria || "Sin categoría"))));
    out.push(el("div", { class: "box" }, el("p", { class: "lbl", text: "Casos por municipio" }), barras(contar((c) => c.municipio || "Sin municipio"))));
    const sst = casos.filter((c) => c.categoria === "SST (accidente o salud)").sort((a, b) => t(b.recibido) - t(a.recibido));
    const box = el("div", { class: "box" }, el("p", { class: "lbl", text: "Salud y accidentes (" + sst.length + ")" }));
    if (!sst.length) box.append(el("p", { class: "sub", text: "Sin casos de SST en este periodo." }));
    sst.forEach((c) => {
      const rep = (c.reenvios || []).some((r) => /sst|jenny/i.test(str(r.para)) && r.enviar && r.enviado);
      const ofrecido = (c.reenvios || []).some((r) => /sst|jenny/i.test(str(r.para)) && r.enviar);
      const chip = c.prioridad === "Urgente" ? (rep ? ["good", "Reportado a SST"] : ["late", "Falta reportar a SST"]) : (rep ? ["good", "Informado a SST"] : ofrecido ? ["warn", "Falta informar a SST"] : ["", "Seguimiento de salud"]);
      box.append(el("div", { class: "sst-row" },
        el("span", {}, el("b", { text: str(c.persona || c.chat) }), document.createTextNode(" · " + [c.hogar, c.municipio].filter(Boolean).join(", "))),
        el("span", { class: "pill " + chip[0], text: chip[1] }),
        el("span", { class: "sub", text: (c.recibido ? fmtCorta.format(new Date(c.recibido)) : "") + (c.plazo_sst ? " · plazo ARL " + fmtCorta.format(new Date(c.plazo_sst + "T12:00:00-05:00")) : "") })));
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
  function updateChrome() {
    const all = [...state.cases.values()];
    const pend = all.filter((c) => c.estado === "Pendiente" && !pospuesto(c)).length;
    const venc = all.filter(segVencido).length;
    const b1 = $("b-bandeja"), b2 = $("b-seguimiento");
    b1.hidden = !pend; b1.textContent = pend > 99 ? "99+" : String(pend);
    b2.hidden = !venc; b2.textContent = String(venc);
    document.querySelectorAll("#tabbar button").forEach((b) => { if (b.dataset.view === state.vista) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    const off = $("offline");
    const pg = outbox.length;
    off.hidden = !state.offline && !pg;
    if (!off.hidden) off.textContent = (state.offline ? "Sin conexión con la hoja. " : "") + (pg ? (pg === 1 ? "1 cambio se guardará" : pg + " cambios se guardarán") + " cuando vuelva la señal." : "Mostrando lo último guardado.");
    const ult = state.estado && state.estado.ultima_revision ? "Última revisión: " + when(state.estado.ultima_revision).toLowerCase() + " · " : "";
    $("last").textContent = ult + "Próxima: " + nextReview();
    try { if (navigator.setAppBadge) (pend ? navigator.setAppBadge(pend) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {}
    renderInstall();
  }
  function render() {
    state.pendingRender = false;
    const all = [...state.cases.values()];
    const focusedId = document.activeElement && document.activeElement.id;
    const selStart = document.activeElement && document.activeElement.selectionStart;
    const v = state.vista;
    const nodos = v === "seguimiento" ? vistaSeguimiento(all) : v === "personas" ? vistaPersonas(all) : v === "panel" ? vistaPanel(all) : vistaBandeja(all);
    $("view").replaceChildren(el("div", { class: "wrap" }, ...nodos));
    updateChrome();
    if (focusedId) { const f = document.getElementById(focusedId); if (f && (f.tagName === "TEXTAREA" || f.tagName === "INPUT")) { f.focus(); try { const n = selStart != null ? selStart : f.value.length; f.setSelectionRange(n, n); } catch (e) {} } }
  }

  // ---------- instalar ----------
  function renderInstall() {
    const b = $("install");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (standalone || store.get(K.install) === "no" || state.vista !== "bandeja") { b.hidden = true; return; }
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!state.installEvt && !ios && !MOVIL) { b.hidden = true; return; }
    b.hidden = false;
    const cerrar = el("button", { type: "button", class: "link", text: "Ocultar", onclick: () => { store.set(K.install, "no"); b.hidden = true; } });
    if (state.installEvt) b.replaceChildren(el("span", { text: "Instala la bandeja en tu celular." }), el("span", {}, el("button", { type: "button", class: "btn primary", style: "min-height:40px", text: "Instalar", onclick: async () => { const e = state.installEvt; state.installEvt = null; e.prompt(); try { await e.userChoice; } catch (x) {} renderInstall(); } }), cerrar));
    else b.replaceChildren(el("span", { text: ios ? "Para tenerla como app: en Safari toca Compartir y luego «Agregar a inicio»." : "Para tenerla como app: abre el menú ⋮ de Chrome y toca «Agregar a la pantalla principal»." }), cerrar);
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
    state.vista = b.dataset.view; store.set(K.vista, state.vista);
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
  if (!cfg) mostrarConfig();
  else { mostrarMain(); render(); sync(); revisarEnvio(); }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
