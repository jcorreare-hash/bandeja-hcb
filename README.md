# Bandeja HCB

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
