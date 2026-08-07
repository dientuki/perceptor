"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { useActionState } from "react";
import { updateSettingsAction } from "@/actions/settings";
import { Setting } from "@/types/settings";

interface SettingsFormProps {
  settings: Setting[];
}

export default function SettingsForm({ settings }: SettingsFormProps) {
  const [state, formAction, isPending] = useActionState(updateSettingsAction, null);

  const valueOf = (key: string) => settings.find((setting) => setting.key === key)?.value ?? "";

  return (
    <form action={formAction}>
      <div className="space-y-8 max-w-lg">
        <div>
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Torrent
          </h3>
          <div className="space-y-6">
            <div>
              <Label htmlFor="torrent_port">Puerto de qBittorrent</Label>
              <Input
                id="torrent_port"
                name="torrent_port"
                defaultValue={valueOf("torrent_port")}
              />
            </div>

            <div>
              <Label htmlFor="path_downloads">Carpeta de descargas</Label>
              <Input
                id="path_downloads"
                name="path_downloads"
                defaultValue={valueOf("path_downloads")}
                hint="Tiene que ser una ruta dentro del volumen montado en el contenedor de qBittorrent; una ruta fuera de ese volumen hace que las descargas vayan a disco efímero."
                required
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Indexer
          </h3>
          <div>
            <Label htmlFor="tracker_api_key">API key del indexer</Label>
            <Input
              id="tracker_api_key"
              name="tracker_api_key"
              type="password"
              defaultValue={valueOf("tracker_api_key")}
            />
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Películas y series
          </h3>
          <div className="space-y-6">
            <div>
              <Label htmlFor="movie_db_api_key">API key de TMDB</Label>
              <Input
                id="movie_db_api_key"
                name="movie_db_api_key"
                type="password"
                defaultValue={valueOf("movie_db_api_key")}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="movies_enabled"
                name="movies_enabled"
                defaultChecked={valueOf("movies_enabled") === "true"}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-700"
              />
              <label htmlFor="movies_enabled" className="text-sm text-gray-700 dark:text-gray-300">
                Habilitar películas
              </label>
            </div>

            <div>
              <Label htmlFor="path_movies">Carpeta de películas</Label>
              <Input
                id="path_movies"
                name="path_movies"
                defaultValue={valueOf("path_movies")}
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="shows_enabled"
                name="shows_enabled"
                defaultChecked={valueOf("shows_enabled") === "true"}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-700"
              />
              <label htmlFor="shows_enabled" className="text-sm text-gray-700 dark:text-gray-300">
                Habilitar series
              </label>
            </div>

            <div>
              <Label htmlFor="path_shows">Carpeta de series</Label>
              <Input
                id="path_shows"
                name="path_shows"
                defaultValue={valueOf("path_shows")}
                required
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Media server
          </h3>
          <p className="text-sm italic text-gray-400 dark:text-gray-500">Próximamente.</p>
        </div>

        {state && "error" in state && state.error && (
          <p className="text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg">
            {state.error}
          </p>
        )}

        {state && "success" in state && state.success && (
          <p className="text-sm text-success-500">Configuración guardada.</p>
        )}

        <div>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
