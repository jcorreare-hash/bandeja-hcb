/* Bandeja HCB: casos de WhatsApp laboral leídos de la hoja de Google a través del puente de Apps Script.
   La app nunca envía mensajes por sí sola: abre WhatsApp con el texto aprobado y la persona lo envía. */
(() => {
  "use strict";

  const TZ = "America/Bogota";
  const K = { cfg: "bandejaHCB.cfg", cache: "bandejaHCB.cache", outbox: "bandejaHCB.outbox", envio: "bandejaHCB.envio", install: "bandejaHCB.install" };
  const DEFAULT_HORARIO = ["8:50", "10:50", "12:50", "14:50", "17:50"];
  const CATS = [
    ["", "Todas"], ["SST (accidente o salud)", "SST"], ["Alimentación", "Alimentación"], ["Permiso o incapacidad", "Permisos"],
    ["Pregunta", "Preguntas"], ["Documento o RAM", "Documentos"], ["Emergencia", "Emergencias"], ["Sindical", "Sindical"], ["Informativo", "Informativo"],
  ];
  const PRIO = { Urgente: 0, Alta: 1, Normal: 2 };
  const CERRADOS = ["Enviado", "Resuelto", "Descartado"];
  const MOVIL = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const WA_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/></svg>';

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const state = {
    tab: "pend", cat: "", cases: new Map(), estado: {}, drafts: new Map(), open: new Set(),
    lastSync: null, syncing: false, offline: false, pendingRender: false, installEvt: null,
  };
  let cfg = store.get(K.cfg);
  let outbox = store.get(K.outbox) || [];

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
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} };

  // ---------- fechas ----------
  const fmtTime0 = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const fmtTime = (d) => fmtTime0.format(d).replace(/\s/g, " ");
  const fmtDate = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  function when(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return str(iso);
    const now = new Date();
    if (dayKey(d) === dayKey(now)) return "Hoy " + fmtTime(d);
    if (dayKey(d) === dayKey(new Date(now.getTime() - 86400000))) return "Ayer " + fmtTime(d);
    return fmtDate.format(d) + " " + fmtTime(d);
  }
  function nextReview() {
    const h = Array.isArray(state.estado.horario) && state.estado.horario.length ? state.estado.horario : DEFAULT_HORARIO;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const mins = Number(get("hour")) * 60 + Number(get("minute"));
    const slots = h.map((x) => { const [a, b] = x.split(":").map(Number); return { m: a * 60 + (b || 0), a, b: b || 0 }; }).filter((s) => !isNaN(s.m)).sort((x, y) => x.m - y.m);
    if (!slots.length) return "";
    const label = (s) => fmtTime(new Date(Date.UTC(2026, 0, 1, s.a + 5, s.b)));
    if (wd >= 1 && wd <= 5) { const s = slots.find((x) => x.m > mins); if (s) return "hoy " + label(s); }
    return (wd === 5 || wd === 6 ? "el lunes " : "mañana ") + label(slots[0]);
  }
  function deadline(c) {
    const p = str(c.plazo_sst);
    if (!p) return null;
    const d = new Date(p + "T12:00:00-05:00");
    const label = isNaN(d) ? p : fmtDate.format(d);
    const t = dayKey(new Date());
    if (CERRADOS.includes(c.estado)) return "Plazo ARL: " + label;
    if (p < t) return "Plazo ARL vencido";
    if (p === t) return "Plazo ARL: hoy";
    return "Plazo ARL: " + label;
  }

  // ---------- WhatsApp ----------
  function normTel(t) {
    let d = str(t).replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 10 && d.startsWith("3")) d = "57" + d;
    return d.length >= 11 ? d : "";
  }
  function waUrl(tel, texto) {
    const n = normTel(tel), t = encodeURIComponent(texto);
    if (MOVIL) return n ? "whatsapp://send?phone=" + n + "&text=" + t : "whatsapp://send?text=" + t;
    return n ? "https://web.whatsapp.com/send?phone=" + n + "&text=" + t : "https://web.whatsapp.com/send?text=" + t;
  }
  function abrirWhatsApp(id, env) {
    if (!normTel(env.telefono)) { try { navigator.clipboard && navigator.clipboard.writeText(env.texto).catch(() => {}); } catch (e) {} }
    store.set(K.envio, { id, key: env.key, t: Date.now() });
    const url = waUrl(env.telefono, env.texto);
    if (window.__abrirUrl) window.__abrirUrl(url);
    else if (MOVIL) window.location.href = url;
    else window.open(url, "_blank", "noopener");
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

  // ---------- datos locales ----------
  function applyCambios(c, cambios) {
    const n = { ...c };
    if (cambios.estado !== undefined) {
      n.estado = cambios.estado;
      if (cambios.estado === "Pendiente") { n.enviado = ""; n.aprobado = ""; n.respuesta_enviada = false; }
      if (cambios.estado === "Enviado" && !n.enviado) n.enviado = new Date().toISOString();
    }
    if (cambios.respuesta !== undefined) n.respuesta = cambios.respuesta;
    if (cambios.nota !== undefined) n.nota = cambios.nota;
    if (cambios.reenvios !== undefined) n.reenvios = cambios.reenvios;
    if (cambios.respuesta_enviada !== undefined) n.respuesta_enviada = !!cambios.respuesta_enviada;
    if (cambios.aprobado) n.aprobado = new Date().toISOString();
    n.actualizado = new Date().toISOString();
    return n;
  }
  function persistCache() { store.set(K.cache, { casos: [...state.cases.values()], estado: state.estado, t: state.lastSync }); }

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

  function queue(id, cambios) {
    const c = state.cases.get(id);
    if (c) state.cases.set(id, applyCambios(c, cambios));
    outbox.push({ id, cambios, t: Date.now() });
    store.set(K.outbox, outbox);
    persistCache();
    render();
    procesarOutbox();
  }
  let procesando = false;
  async function procesarOutbox() {
    if (procesando || !cfg) return;
    procesando = true;
    try {
      while (outbox.length) {
        const op = outbox[0];
        try {
          const j = await api({ accion: "actualizar", id: op.id, cambios: op.cambios });
          outbox.shift();
          store.set(K.outbox, outbox);
          let caso = j.caso;
          for (const later of outbox) if (later.id === op.id) caso = applyCambios(caso, later.cambios);
          state.cases.set(op.id, caso);
          persistCache();
        } catch (e) {
          if (e.code === "no_existe" || e.code === "estado" || e.code === "id") { outbox.shift(); store.set(K.outbox, outbox); continue; }
          if (e.code === "clave") { mostrarConfig("La clave dejó de funcionar. Revísala."); break; }
          state.offline = true;
          break;
        }
      }
    } finally {
      procesando = false;
      render();
    }
  }

  async function sync(manual) {
    if (!cfg || state.syncing) return;
    state.syncing = true; setSpin(true);
    try {
      await procesarOutbox();
      const j = await api({ accion: "listar" });
      const casos = Array.isArray(j.casos) ? j.casos : [];
      state.cases = new Map(casos.map((c) => [c.id, c]));
      for (const op of outbox) { const c = state.cases.get(op.id); if (c) state.cases.set(op.id, applyCambios(c, op.cambios)); }
      state.estado = j.estado || {};
      state.lastSync = Date.now();
      state.offline = false;
      persistCache();
      if (manual) toast("Actualizado");
    } catch (e) {
      if (e.code === "clave") { mostrarConfig("La clave no es correcta. Revísala."); return; }
      state.offline = true;
      if (manual) toast("No se pudo actualizar. Revisa la conexión.");
    } finally {
      state.syncing = false; setSpin(false);
      renderSafe();
    }
  }
  function setSpin(on) { $("btn-refresh").classList.toggle("spin", !!on); }

  // ---------- acciones ----------
  function draftFor(c) {
    if (!state.drafts.has(c.id)) {
      const opts = Array.isArray(c.opciones) ? c.opciones.map(str) : [];
      const fwd = (Array.isArray(c.reenvios) ? c.reenvios : []).map((r) => ({ para: str(r.para), telefono: str(r.telefono), texto: str(r.texto), enviar: r.enviar !== false, edit: false }));
      const resp = str(c.respuesta);
      state.drafts.set(c.id, {
        sel: resp ? (opts.indexOf(resp) >= 0 ? opts.indexOf(resp) : -2) : opts.length ? 0 : -1,
        text: resp || opts[0] || "",
        editing: !!resp && opts.indexOf(resp) < 0,
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
    state.drafts.delete(c.id);
    queue(c.id, { estado: "Aprobado", respuesta: texto, reenvios, nota: d.nota.trim(), aprobado: true, respuesta_enviada: false });
    const env = enviosDe(state.cases.get(c.id)).find((e) => !e.enviado);
    buzz();
    if (env) abrirWhatsApp(c.id, env);
  }

  function marcarEnviado(id, key) {
    const c = state.cases.get(id);
    if (!c) return null;
    const cambios = {};
    if (key === "r") cambios.respuesta_enviada = true;
    else {
      const i = Number(key.slice(1));
      cambios.reenvios = (c.reenvios || []).map((r, j) => (j === i ? { ...r, enviado: true } : r));
    }
    if (enviosDe(applyCambios(c, cambios)).every((e) => e.enviado)) cambios.estado = "Enviado";
    queue(id, cambios);
    buzz();
    return state.cases.get(id);
  }

  // ---------- confirmación al volver de WhatsApp ----------
  function revisarEnvio() {
    const p = store.get(K.envio);
    if (!p || Date.now() - p.t < 1200) return;
    const c = state.cases.get(p.id);
    if (!c) { store.del(K.envio); return; }
    const env = enviosDe(c).find((e) => e.key === p.key);
    if (!env || env.enviado) { store.del(K.envio); return; }
    abrirHoja(
      el("h2", { text: "¿Se envió el mensaje a " + env.para + "?" }),
      el("p", { text: "Confírmalo para dejarlo registrado en la bitácora." }),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn primary", text: "Sí, se envió", onclick: () => { store.del(K.envio); cerrarHoja(); const n = marcarEnviado(c.id, env.key); siguiente(n); } }),
        el("button", { type: "button", class: "btn", html: WA_ICON + "<span>Abrir WhatsApp otra vez</span>", onclick: () => { cerrarHoja(); abrirWhatsApp(c.id, env); } }),
        el("button", { type: "button", class: "btn quiet", text: "No, lo envío después", onclick: () => { store.del(K.envio); cerrarHoja(); } }),
      ),
    );
  }
  function siguiente(c) {
    if (!c) return;
    const env = enviosDe(c).find((e) => !e.enviado);
    if (!env) { toast("Caso enviado ✓"); return; }
    abrirHoja(
      el("h2", { text: "Falta enviar a " + env.para }),
      el("p", { class: "", text: env.texto.length > 160 ? env.texto.slice(0, 160) + "…" : env.texto }),
      el("div", { class: "btns" },
        el("button", { type: "button", class: "btn wa", html: WA_ICON + "<span>Abrir WhatsApp</span>", onclick: () => { cerrarHoja(); abrirWhatsApp(c.id, env); } }),
        el("button", { type: "button", class: "btn quiet", text: "Más tarde", onclick: cerrarHoja }),
      ),
    );
  }
  function abrirHoja(...kids) {
    const root = $("sheet-root");
    const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) cerrarHoja(); } }, el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, ...kids));
    root.replaceChildren(bg);
    const b = root.querySelector("button"); if (b) b.focus();
  }
  function cerrarHoja() { $("sheet-root").replaceChildren(); }

  let toastTimer;
  function toast(msg, undo) {
    const t = $("toast");
    t.replaceChildren(el("span", { text: msg }));
    if (undo) t.append(el("button", { type: "button", text: "Deshacer", onclick: () => { t.hidden = true; undo(); } }));
    t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), undo ? 5000 : 2600);
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
    body.append(
      el("div", { class: "top" }, el("span", { class: "who", text: str(c.persona) || str(c.chat) }), el("span", { class: "time", text: when(c.recibido) })),
      el("div", { class: "where" },
        el("span", { text: [c.chat && c.chat !== c.persona ? "en " + str(c.chat) : "", str(c.hogar), str(c.municipio)].filter(Boolean).join(" · ") }),
        tel ? el("a", { href: "tel:+" + tel, text: "Llamar" }) : null),
      el("div", { class: "pills" },
        el("span", { class: "pill cat", text: str(c.categoria) || "Sin categoría" }),
        c.prioridad && c.prioridad !== "Normal" ? el("span", { class: "pill prio-" + c.prioridad, text: str(c.prioridad) }) : null,
        c.origen === "Audio" ? el("span", { class: "pill", text: "Audio" }) : null,
        deadline(c) ? el("span", { class: "pill deadline", text: deadline(c) }) : null,
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
      opts.forEach((o, i) => box.append(el("button", { type: "button", class: "opt", "aria-pressed": String(d.sel === i), text: o,
        onclick: () => { d.sel = i; d.text = o; d.editing = false; render(); } })));
      box.append(el("button", { type: "button", class: "opt own", "aria-pressed": String(d.sel < 0), text: d.sel < 0 ? "Mi propia respuesta" : "Escribir mi propia respuesta",
        onclick: () => { if (d.sel >= 0) { d.sel = -1; d.text = ""; } d.editing = true; render(); const t = $("resp-" + c.id); if (t) t.focus(); } }));
      body.append(box);
      if (d.editing || d.sel < 0) {
        const ta = el("textarea", { id: "resp-" + c.id, "aria-label": "Texto de la respuesta", rows: 4, placeholder: "Escribe la respuesta como la enviarías" });
        ta.value = d.text;
        ta.addEventListener("input", () => { d.text = ta.value; if (d.sel >= 0) d.sel = -2; });
        body.append(ta);
      } else if (opts.length) {
        body.append(el("button", { type: "button", class: "link", text: "Editar el texto elegido", onclick: () => { d.editing = true; render(); const t = $("resp-" + c.id); if (t) t.focus(); } }));
      }
    }
    d.fwd.forEach((r, i) => {
      const cb = el("input", { type: "checkbox", id: "fwd-" + c.id + "-" + i, role: "switch" });
      cb.checked = r.enviar;
      cb.addEventListener("change", () => { r.enviar = cb.checked; render(); });
      const fwd = el("div", { class: "fwd" },
        el("label", { class: "switch", for: cb.id }, el("span", {}, document.createTextNode("Enviar también a " + r.para), el("span", { class: "num", text: r.telefono || "sin número" })), cb));
      if (r.enviar) {
        if (r.edit) {
          const t = el("textarea", { id: "fwdt-" + c.id + "-" + i, rows: 5, "aria-label": "Mensaje para " + r.para });
          t.value = r.texto; t.addEventListener("input", () => { r.texto = t.value; });
          fwd.append(t);
        } else fwd.append(el("button", { type: "button", class: "link", text: "Ver o editar el mensaje", onclick: () => { r.edit = true; render(); } }));
      }
      body.append(fwd);
    });
    if (d.showNote) {
      const note = el("textarea", { id: "nota-" + c.id, rows: 2, placeholder: "Nota para la bitácora", "aria-label": "Nota" });
      note.style.minHeight = "64px";
      note.value = d.nota; note.addEventListener("input", () => { d.nota = note.value; });
      body.append(note);
    } else body.append(el("button", { type: "button", class: "link", text: "+ Agregar una nota", onclick: () => { d.showNote = true; render(); const n = $("nota-" + c.id); if (n) n.focus(); } }));

    const hayEnvio = !!c.destinatario || d.fwd.some((r) => r.enviar);
    const sinTel = c.destinatario && !normTel(c.telefono);
    const actions = el("div", { class: "actions" });
    if (hayEnvio) actions.append(el("button", { type: "button", class: "btn wa full", html: WA_ICON + "<span>Aprobar y enviar por WhatsApp</span>", onclick: () => aprobarYEnviar(c) }));
    actions.append(
      el("button", { type: "button", class: "btn", text: "Ya lo resolví", onclick: () => { const nota = d.nota.trim(); state.drafts.delete(c.id); queue(c.id, { estado: "Resuelto", nota }); toast("Marcado como resuelto", () => queue(c.id, { estado: "Pendiente" })); } }),
      el("button", { type: "button", class: "btn quiet", text: "Descartar", onclick: () => { state.drafts.delete(c.id); queue(c.id, { estado: "Descartado" }); toast("Caso descartado", () => queue(c.id, { estado: "Pendiente" })); } }),
    );
    body.append(actions);
    if (hayEnvio && sinTel) body.append(el("p", { class: "sub", text: "Sin número guardado: WhatsApp te pedirá elegir el chat y el texto queda copiado." }));
  }

  function tarjetaPorEnviar(c, body) {
    const envs = enviosDe(c);
    const list = el("div", { class: "send-list" });
    envs.forEach((env) => {
      const item = el("div", { class: "send-item" },
        el("div", { class: "row" }, el("span", { class: "who2", text: (env.key === "r" ? "Respuesta a " : "Para ") + env.para }), el("span", { class: "st" + (env.enviado ? " done" : ""), text: env.enviado ? "Enviado" : "Falta enviar" })),
        el("div", { class: "txt", text: env.texto }));
      if (!env.enviado) item.append(el("div", { class: "btns" },
        el("button", { type: "button", class: "btn wa", html: WA_ICON + "<span>Abrir</span>", onclick: () => abrirWhatsApp(c.id, env) }),
        el("button", { type: "button", class: "btn", text: "Ya lo envié", onclick: () => { const n = marcarEnviado(c.id, env.key); if (n && n.estado === "Enviado") toast("Caso enviado ✓"); } })));
      list.append(item);
    });
    body.append(el("p", { class: "lbl", text: "Mensajes aprobados" }), list,
      el("div", { class: "actions" }, el("button", { type: "button", class: "btn quiet full", text: "Volver a pendiente", onclick: () => { queue(c.id, { estado: "Pendiente" }); toast("Volvió a pendientes"); } })));
  }

  function tarjetaCerrada(c, body) {
    if (c.respuesta) body.append(el("p", { class: "lbl", text: (c.respuesta_enviada || c.estado === "Enviado" ? "Enviado a " : "Respuesta para ") + str(c.destinatario) }), el("div", { class: "final", text: str(c.respuesta) }));
    (Array.isArray(c.reenvios) ? c.reenvios : []).filter((r) => r.enviar && r.texto).forEach((r) =>
      body.append(el("p", { class: "lbl", text: "Para " + str(r.para) }), el("div", { class: "final", text: str(r.texto) })));
    if (c.nota) body.append(el("p", { class: "lbl", text: "Nota" }), el("p", { class: "summary", style: "font-weight:400;font-size:.92rem", text: str(c.nota) }));
    if (c.estado === "Enviado" && c.enviado) body.append(el("p", { class: "sub", text: "Enviado " + when(c.enviado).toLowerCase() }));
    if (c.estado === "Resuelto" || c.estado === "Descartado")
      body.append(el("div", { class: "actions" }, el("button", { type: "button", class: "btn quiet full", text: "Volver a pendiente", onclick: () => { queue(c.id, { estado: "Pendiente" }); toast("Volvió a pendientes"); } })));
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

  // ---------- render ----------
  function renderFilters(pool) {
    const f = $("filters");
    const present = new Set(pool.map((c) => c.categoria));
    const chips = CATS.filter(([v]) => !v || present.has(v) || state.cat === v);
    f.hidden = chips.length <= 2 && !state.cat;
    f.replaceChildren(...chips.map(([v, label]) => el("button", { type: "button", class: "chip", "aria-pressed": String(state.cat === v), text: label, onclick: () => { state.cat = v; render(); } })));
  }

  function renderSafe() {
    const a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && $("list").contains(a)) { state.pendingRender = true; return; }
    render();
  }

  function render() {
    state.pendingRender = false;
    const all = [...state.cases.values()];
    const pend = all.filter((c) => c.estado === "Pendiente");
    const ready = all.filter((c) => c.estado === "Aprobado");
    const urgent = pend.filter((c) => c.prioridad === "Urgente");
    $("n-pend").textContent = String(pend.length);
    $("n-ready").textContent = String(ready.length);

    const alert = $("alert");
    alert.hidden = !urgent.length;
    if (urgent.length) alert.textContent = urgent.length === 1 ? "1 caso urgente sin resolver" : urgent.length + " casos urgentes sin resolver";

    const off = $("offline");
    const pendientesGuardar = outbox.length;
    off.hidden = !state.offline && !pendientesGuardar;
    if (!off.hidden) off.textContent = (state.offline ? "Sin conexión con la hoja. " : "") + (pendientesGuardar ? (pendientesGuardar === 1 ? "1 cambio se guardará" : pendientesGuardar + " cambios se guardarán") + " cuando vuelva la señal." : "Mostrando lo último guardado.");

    const ult = state.estado && state.estado.ultima_revision ? "Última revisión: " + when(state.estado.ultima_revision).toLowerCase() + " · " : "";
    $("last").textContent = ult + "Próxima: " + nextReview();

    const inTab = (c) => state.tab === "pend" ? c.estado === "Pendiente" : state.tab === "ready" ? c.estado === "Aprobado" : CERRADOS.includes(c.estado);
    const pool = all.filter(inTab);
    renderFilters(pool);
    const shown = pool.filter((c) => !state.cat || c.categoria === state.cat).sort((a, b) => state.tab === "closed"
      ? str(b.actualizado || b.recibido).localeCompare(str(a.actualizado || a.recibido))
      : (PRIO[a.prioridad] ?? 2) - (PRIO[b.prioridad] ?? 2) || str(a.recibido).localeCompare(str(b.recibido)));
    const list = $("list");
    const focusedId = document.activeElement && document.activeElement.id;
    if (!shown.length) {
      const msg = state.tab === "pend" ? (state.cat ? "No hay pendientes en esta categoría." : all.length ? "Todo al día." : (state.lastSync ? "Aún no hay casos." : "Cargando casos…"))
        : state.tab === "ready" ? "No hay mensajes esperando envío." : "Todavía no hay casos cerrados.";
      const hint = state.tab === "pend" && state.lastSync ? "Después de cada revisión aparecen aquí los mensajes laborales con la acción sugerida y las respuestas para elegir." : "";
      list.replaceChildren(el("div", { class: "empty" }, el("strong", { text: msg }), hint ? document.createTextNode(hint) : null));
    } else list.replaceChildren(...shown.map(tarjeta));
    if (focusedId) { const f = document.getElementById(focusedId); if (f && f.tagName === "TEXTAREA") { f.focus(); const n = f.value.length; try { f.setSelectionRange(n, n); } catch (e) {} } }
    renderInstall();
  }

  // ---------- instalar ----------
  function renderInstall() {
    const b = $("install");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (standalone || store.get(K.install) === "no") { b.hidden = true; return; }
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!state.installEvt && !ios && !MOVIL) { b.hidden = true; return; }
    b.hidden = false;
    const cerrar = el("button", { type: "button", class: "link", text: "Ocultar", onclick: () => { store.set(K.install, "no"); b.hidden = true; } });
    if (state.installEvt) {
      b.replaceChildren(el("span", { text: "Instala la bandeja en tu celular." }),
        el("span", {}, el("button", { type: "button", class: "btn primary", style: "min-height:40px", text: "Instalar", onclick: async () => { const e = state.installEvt; state.installEvt = null; e.prompt(); try { await e.userChoice; } catch (x) {} renderInstall(); } }), cerrar));
    } else {
      b.replaceChildren(el("span", { text: ios ? "Para tenerla como app: en Safari toca Compartir y luego «Agregar a inicio»." : "Para tenerla como app: abre el menú ⋮ de Chrome y toca «Agregar a la pantalla principal»." }), cerrar);
    }
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installEvt = e; renderInstall(); });

  // ---------- configuración ----------
  function leerHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const u = h.get("puente"), c = h.get("clave");
    if (u && c) {
      cfg = { url: u, clave: c };
      store.set(K.cfg, cfg);
      history.replaceState(null, "", location.pathname + location.search);
      return true;
    }
    return false;
  }
  window.addEventListener("hashchange", () => { if (leerHash()) { mostrarMain(); render(); sync(); } });
  function mostrarConfig(err) {
    $("main").hidden = true;
    $("setup").hidden = false;
    $("cfg-url").value = cfg ? cfg.url : "";
    $("cfg-key").value = cfg ? cfg.clave : "";
    $("cfg-err").hidden = !err; $("cfg-err").textContent = err || "";
    $("cfg-cancel").hidden = !cfg || !!err;
  }
  function mostrarMain() { $("setup").hidden = true; $("main").hidden = false; }
  $("cfg-save").addEventListener("click", async () => {
    const url = $("cfg-url").value.trim(), clave = $("cfg-key").value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { $("cfg-err").hidden = false; $("cfg-err").textContent = "El enlace debe ser el de la aplicación web de Apps Script (https://script.google.com/…)."; return; }
    if (!clave) { $("cfg-err").hidden = false; $("cfg-err").textContent = "Falta la clave."; return; }
    const prev = cfg;
    cfg = { url, clave };
    $("cfg-save").disabled = true; $("cfg-save").textContent = "Conectando…";
    try {
      await api({ accion: "listar" });
      store.set(K.cfg, cfg);
      mostrarMain(); sync();
    } catch (e) {
      cfg = prev;
      $("cfg-err").hidden = false;
      $("cfg-err").textContent = e.code === "clave" ? "La clave no es correcta." : "No pude conectarme al puente. Revisa el enlace y la conexión.";
    } finally { $("cfg-save").disabled = false; $("cfg-save").textContent = "Conectar"; }
  });
  $("cfg-cancel").addEventListener("click", () => { mostrarMain(); });
  $("btn-settings").addEventListener("click", () => mostrarConfig());
  $("btn-refresh").addEventListener("click", () => sync(true));

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    state.tab = t.dataset.tab; state.cat = "";
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    render(); window.scrollTo({ top: 0 });
  }));
  document.addEventListener("focusout", () => setTimeout(() => { if (state.pendingRender) renderSafe(); }, 0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    revisarEnvio();
    if (!state.lastSync || Date.now() - state.lastSync > 30000) sync();
  });
  window.addEventListener("focus", () => revisarEnvio());
  window.addEventListener("online", () => { procesarOutbox(); sync(); });
  setInterval(() => { if (document.visibilityState === "visible") sync(); }, 90000);

  // ---------- inicio ----------
  leerHash();
  const cache = store.get(K.cache);
  if (cache && Array.isArray(cache.casos)) {
    state.cases = new Map(cache.casos.map((c) => [c.id, c]));
    state.estado = cache.estado || {};
    state.lastSync = cache.t || null;
  }
  if (!cfg) mostrarConfig();
  else { mostrarMain(); render(); sync(); revisarEnvio(); }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
