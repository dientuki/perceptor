//import { initDB } from "@/db/schema";
//import { startWorker } from "@/core/jobs/worker";

let started = false;

export async function register() {
  if (started) return;
  started = true;

  console.log("Initializing DB and worker...");
  //initDB();
  //startWorker();
}