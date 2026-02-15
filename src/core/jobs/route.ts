import db from "@/db/client";

export async function POST(req: Request) {
  const { filename, language } = await req.json();

  const stmt = db.prepare("INSERT INTO jobs (filename, language) VALUES (?, ?)");
  const info = stmt.run(filename, language);

  return Response.json({ id: info.lastInsertRowid, success: true });
}

// También un GET para ver la cola desde la UI
export async function GET() {
  const jobs = db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 20").all();
  return Response.json(jobs);
}