# 👁️ Perceptor

**Perceptor** es tu centro de mando inteligente para la gestión de contenido multimedia. Olvídate de procesos manuales y tediosos; Perceptor automatiza todo el ciclo de vida de tus películas y series favoritas, optimizando el espacio y organizando tu biblioteca de forma automática.

## 🌟 ¿Qué puedes hacer con Perceptor?

Perceptor ofrece un flujo de trabajo simplificado y potente para los amantes del cine y las series:

1.  **Búsqueda Inteligente:** Encuentra rápidamente películas y series gracias a una interfaz intuitiva potenciada por IA.
2.  **Gestión de Descargas:** Manejo eficiente de archivos a través de protocolos de descarga optimizados (torrents).
3.  **Compresión de Siguiente Generación (AV1):** Reduce drásticamente el tamaño de tus archivos sin perder calidad visual, utilizando el codec AV1. Ideal para ahorrar espacio en disco y mejorar el streaming.
4.  **Sincronización con Jellyfin:** Envía automáticamente el contenido procesado a tu servidor Jellyfin, listo per ser disfrutado en cualquier dispositivo.

## ✨ Características Principales

*   **Automatización de Extremo a Extremo:** Desde que buscas el contenido hasta que aparece en tu televisión.
*   **Optimización de Memoria:** Diseñado para ejecutarse de forma fluida incluso en servidores Linux con recursos ajustados, especialmente durante el procesamiento de video.
*   **Interfaz Moderna:** Una experiencia de usuario rápida y limpia, construida para ser tan funcional como atractiva.
*   **Impulsado por IA:** Utiliza modelos de lenguaje avanzados para facilitar la búsqueda y organización del contenido.

## 🚀 Resumen Técnico (Para desarrolladores)

Aunque Perceptor se enfoca en la facilidad de uso, por dentro es una bestia técnica:

-   **Core:** Next.js 16 (App Router) y React 19.
-   **Estilos:** Tailwind CSS v4.
-   **Base de Datos:** Prisma + SQLite (better-sqlite3).
-   **IA:** Integración con Google GenAI.
-   **Monitorización:** Logging de alto rendimiento con Pino.
-   **Calidad:** Formateo y linting ultra rápido con Biome.

## 🏁 Inicio Rápido

### Requisitos Previos

- Node.js (versión compatible con Next.js 16)
- npm / pnpm / yarn

### Servicios Externos y Herramientas

Para que Perceptor funcione a pleno rendimiento y pueda gestionar tu contenido multimedia, necesitarás tener instalados y configurados los siguientes servicios y herramientas en tu sistema:

*   **FFmpeg:** Esencial para el procesamiento y compresión de video (especialmente a AV1).
    *   Asegúrate de tener una versión reciente instalada y accesible en tu `PATH`. Puedes encontrar instrucciones de instalación para tu sistema operativo en la documentación oficial de FFmpeg.

*   **Prowlarr:** Un indexador de torrents que Perceptor utilizará para buscar películas y series.
    *   Deberás configurarlo para que apunte a tus trackers preferidos. Consulta la documentación de Prowlarr para su instalación y configuración.

*   **qBittorrent:** Un cliente de torrents que Perceptor usará para descargar el contenido encontrado.
    *   Asegúrate de que esté configurado para permitir el acceso remoto (API WebUI) para que Perceptor pueda interactuar con él. Más información en la documentación de qBittorrent.

*   **Jellyfin:** Tu servidor multimedia donde Perceptor organizará y enviará el contenido procesado.
    *   Perceptor interactuará con tu instancia de Jellyfin para añadir y actualizar tu biblioteca. Visita la documentación de Jellyfin para su instalación.


### Instalación

1.  Clona el repositorio:
    ```bash
    git clone https://github.com/tu-usuario/perceptor.git
    cd perceptor
    ```

2.  Instala las dependencias:
    ```bash
    npm install
    ```

3.  Configura las variables de entorno:
    Crea un archivo `.env` basado en el ejemplo y añade tu `GOOGLE_GENAI_API_KEY`.

4.  Prepara la base de datos:
    ```bash
    npx prisma generate
    npx prisma db push
    ```

5.  Inicia el servidor de desarrollo:
    ```bash
    npm run dev
    ```

## 🛠️ Comandos de Desarrollo

### Base de Datos (Prisma)

Perceptor utiliza Prisma para la gestión de datos. Aquí tienes los comandos más frecuentes:

*   **Visualizar datos:** Abre una interfaz gráfica en tu navegador para explorar y editar la base de datos de forma sencilla.
    ```bash
    npx prisma studio
    ```
*   **Actualizar esquema:** Si realizas cambios en `prisma/schema.prisma`, usa estos comandos para regenerar el cliente y aplicar los cambios:
    ```bash
    npx prisma generate
    npx prisma db push
    ```

##  Licencia

Este proyecto está bajo la Licencia [Tu Licencia]. Consulta el archivo `LICENSE` para más detalles.

---
Desarrollado con ❤️ para simplificar tu vida digital.