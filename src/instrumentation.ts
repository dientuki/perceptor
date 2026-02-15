export async function register() {
  // Solo queremos que el worker corra en el servidor de Node.js
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/core/jobs/worker");

    console.log("🚀 Servidor iniciado. Arrancando motores...");
    
    // initDB(); // Si necesitas crear tablas al inicio
    startWorker();
  }
}