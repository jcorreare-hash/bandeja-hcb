# Bandeja HCB (versión 3)

App para el celular que muestra los mensajes laborales de WhatsApp de las madres comunitarias, ya transcritos y clasificados por Claude, con respuestas sugeridas para aprobar.

- Los casos vienen de la hoja de Google «Bitácora WhatsApp laboral – Madres comunitarias», a través de un puente de Apps Script protegido con clave.
- La app **no envía mensajes sola**: al aprobar, abre WhatsApp con el texto listo en el chat de la persona y quien la usa toca enviar.
- Este repositorio solo tiene el código de la app. Los datos de los casos no se guardan aquí.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Pantalla de la app |
| `app.js` | Funcionamiento: leer casos, aprobar, abrir WhatsApp, confirmar envíos |
| `manifest.webmanifest`, `sw.js` | Permiten instalarla como app y abrirla sin señal |
| `icon-*.png`, `apple-touch-icon.png` | Íconos |

## Importante

El código del puente (`Puente_Bandeja_HCB.gs`) **no se sube a este repositorio**: tiene la clave. Va pegado en la hoja de Google, en Extensiones > Apps Script.

## Novedades de la versión 3

- Bandeja dividida en **Urgente**, **Para responder** y **Para revisar**, con la edad de cada caso en color según la prioridad.
- Lista compacta: se toca un caso para abrirlo. Deslizar a la derecha lo marca **resuelto**; a la izquierda lo **pospone**.
- Detalle del caso con la **conversación** en burbujas, los **documentos leídos** (tipo, desde, hasta, días y diagnóstico) y las respuestas sugeridas.
- Después de aprobar, resolver o descartar, la app pasa sola al **siguiente caso**.
- **Selección de varios casos** para resolverlos, posponerlos o aprobarlos con la primera respuesta sugerida.
- Si la hoja rechaza un cambio, la app lo avisa en vez de perderlo en silencio.
