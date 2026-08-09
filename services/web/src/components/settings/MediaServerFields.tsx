"use client";

import { useState } from "react";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Select from "@/components/form/Select";
import { MediaServerOption } from "@/types/media-server";

interface MediaServerFieldsProps {
  options: MediaServerOption[];
  client: string;
  host: string;
  port: string;
  apiKey: string;
}

const NONE = "none";

// Combo "none"/"jellyfin"/... (las opciones salen de mediaServerClients, ver
// actions/media-server.ts — nunca hardcodeadas acá) + los campos de conexión,
// que sólo se muestran y sólo viajan en el FormData cuando el cliente elegido
// no es 'none'. Con 'none' esos tres inputs no se renderizan → no viajan →
// EDITABLE_KEYS los descarta y la DB conserva la config anterior (ver
// actions/settings.ts): volver a elegir Jellyfin recupera host/port/api key.
export default function MediaServerFields({ options, client, host, port, apiKey }: MediaServerFieldsProps) {
  const [selected, setSelected] = useState(client || NONE);

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="media_server_client">Media server</Label>
        <Select
          id="media_server_client"
          name="media_server_client"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          options={options.map((option) => ({ value: option.id, label: option.label }))}
        />
      </div>

      {selected !== NONE && (
        <>
          <div>
            <Label htmlFor="media_server_host">Host</Label>
            <Input
              id="media_server_host"
              name="media_server_host"
              defaultValue={host}
              placeholder="host.docker.internal"
              hint="Vacío por defecto a propósito: 'localhost' acá sería este mismo servidor, no tu media server. Si corre en tu PC, usá host.docker.internal; si corre en otro container de este stack, el nombre de ese servicio."
            />
          </div>

          <div>
            <Label htmlFor="media_server_port">Puerto</Label>
            <Input id="media_server_port" name="media_server_port" defaultValue={port} />
          </div>

          <div>
            <Label htmlFor="media_server_api_key">API key</Label>
            <Input id="media_server_api_key" name="media_server_api_key" type="password" defaultValue={apiKey} />
          </div>
        </>
      )}
    </div>
  );
}
