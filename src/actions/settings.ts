"use server";

import { updateSettingById } from "@/models/settings.model";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

export interface UpdatePathSettingsData {
  path_downloads: { id: number; value: string };
  path_movies: { id: number; value: string };
  path_shows: { id: number; value: string };
}

/**
 * Server Action para actualizar las rutas de descarga y multimedia.
 * @param data Objeto con las nuevas rutas.
 * @returns Un objeto indicando el éxito o fracaso de la operación.
 */
export async function updatePathSettings(data: UpdatePathSettingsData) {
  logger.info({ data }, "Attempting to update path settings via Server Action.");
  try {
    await updateSettingById(data.path_downloads.id, data.path_downloads.value);
    await updateSettingById(data.path_movies.id, data.path_movies.value);
    await updateSettingById(data.path_shows.id, data.path_shows.value);
    logger.info("Path settings updated successfully.");
    revalidatePath("/settings");
    return { success: true, message: "Paths updated successfully." };
  } catch (error) {
    logger.error({ error, data }, "Failed to update path settings.");
    return { success: false, message: "Failed to update paths." };
  }
}