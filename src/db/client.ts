//import Database from 'better-sqlite3';
//import path from 'path';
//
//// Guardamos la DB en la raíz del proyecto
//const dbPath = path.resolve(process.cwd(), 'jobs.db');
//const db = new Database(dbPath);
//
//// Creamos la tabla si no existe
//db.exec(`
//  CREATE TABLE IF NOT EXISTS jobs (
//    id INTEGER PRIMARY KEY AUTOINCREMENT,
//    filename TEXT NOT NULL,
//    language TEXT NOT NULL,
//    status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
//    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
//  )
//`);
//
//export default db;