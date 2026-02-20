import { prisma } from "@lib/prisma";
//import { Request, Response } from "express";

// GET /api/settings
export async function getSettings(req: Request, res: Response) {
  const settings = await prisma.setting.findMany({
    select: {
      key: true,
      value: true,
    },
  });

  const parsed = Object.fromEntries(
    settings.map(s => [s.key, s.value])
  );

  res.json(parsed);
}

// GET /api/settings/:key
export async function getSetting(req: Request, res: Response) {
  const { key } = req.params;

  const setting = await prisma.setting.findUnique({
    where: { key },
  });

  if (!setting) {
    return res.status(404).json({ error: "Setting not found" });
  }

  res.json(setting);
}

// PUT /api/settings/:key
export async function upsertSetting(req: Request, res: Response) {
  const { key } = req.params;
  const { value } = req.body;

  const setting = await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });

  res.json(setting);
}
