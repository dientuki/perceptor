"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import PathPicker from "@/components/settings/PathPicker";
import MediaServerFields from "@/components/settings/MediaServerFields";
import { useActionState } from "react";
import { updateSettingsAction } from "@/actions/settings";
import { Setting } from "@/types/settings";
import { MediaRoot } from "@/types/media-roots";
import { MediaServerOption } from "@/types/media-server";

interface SettingsFormProps {
  settings: Setting[];
  mediaRoots: MediaRoot[];
  mediaServerOptions: MediaServerOption[];
}

export default function SettingsForm({ settings, mediaRoots, mediaServerOptions }: SettingsFormProps) {
  const [state, formAction, isPending] = useActionState(updateSettingsAction, null);

  const valueOf = (key: string) => settings.find((setting) => setting.key === key)?.value ?? "";
  const rootOf = (id: string): MediaRoot =>
    mediaRoots.find((root) => root.id === id) ?? { id, label: id, hostPath: "?", available: false };

  return (
    <form action={formAction}>
      <div className="space-y-8 max-w-lg">
        <div>
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Torrent
          </h3>
          <div className="space-y-6">
            <PathPicker
              settingKey="path_downloads"
              label="Carpeta de descargas"
              root={rootOf("downloads")}
              value={valueOf("path_downloads")}
            />
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

            <PathPicker
              settingKey="path_movies"
              label="Carpeta de películas"
              root={rootOf("library")}
              value={valueOf("path_movies")}
            />

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

            <PathPicker
              settingKey="path_shows"
              label="Carpeta de series"
              root={rootOf("library")}
              value={valueOf("path_shows")}
            />
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Media server
          </h3>
          <MediaServerFields
            options={mediaServerOptions}
            client={valueOf("media_server_client")}
            host={valueOf("media_server_host")}
            port={valueOf("media_server_port")}
            apiKey={valueOf("media_server_api_key")}
          />
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
