# Cotizador DEX 2.0

Primera reconstrucción del cotizador comercial DEX, preparada para desplegarse en Render.

## Qué incluye esta versión

- Interfaz inspirada en el Cotizador DEX original.
- Datos del cliente y contenido completo de la propuesta.
- Biblioteca DEX de temarios extraída del compendio proporcionado.
- Matriz de precios 2026 integrada como referencia comercial.
- Históricos de ingresos 2025 integrados como comparables.
- DEXI sin API de pago:
  - busca el temario más parecido;
  - detecta horas, modalidad y participantes cuando aparecen en el texto;
  - cruza matriz e históricos;
  - sugiere precio y rango de referencia;
  - prepara un prompt profesional para usar manualmente en ChatGPT si se requiere.
- Catálogo DEX.
- Históricos consultables.
- Guardado de borrador en el navegador.
- Vista previa.
- Descarga directa en PDF.
- Descarga en Word editable (.docx).

## Importante

Esta versión NO usa la API de OpenAI y por lo tanto no genera consumo de API.

Los borradores y cambios manuales del usuario se guardan en `localStorage` del navegador. Los archivos de biblioteca, matriz e históricos están incluidos en el proyecto como JSON de solo lectura. Para una segunda etapa se puede conectar una base de datos gratuita/persistente para trabajo multiusuario.

## Ejecutar localmente

Requiere Node.js 20 o superior.

```bash
npm install
npm start
```

Abrir:

```text
http://localhost:3000
```

## Publicar en Render

1. Crear un repositorio nuevo en GitHub, por ejemplo `cotizador-dex-2`.
2. Subir el contenido de esta carpeta al repositorio.
3. En Render seleccionar **New > Web Service**.
4. Conectar el repositorio de GitHub.
5. Configurar:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Plan: Free
```

6. No se requieren variables de entorno en esta primera versión.
7. Publicar.

También se incluye `render.yaml` por si se prefiere desplegar mediante Blueprint.

## Estructura

```text
cotizador-dex-2/
├── server.js
├── package.json
├── render.yaml
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── data/
    ├── temarios.json
    ├── precios.json
    ├── historicos.json
    └── consultores.json
```

## Siguiente etapa recomendada

- Usuarios/vendedores.
- Folio automático de cotización.
- Base de datos persistente.
- Historial de cotizaciones enviadas y monto contratado.
- Motor de margen/costo de consultor y viáticos.
- Plantilla PDF/Word corporativa final de DEX.
- Integración opcional con IA únicamente si DEX decide autorizar presupuesto.
