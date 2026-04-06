"use client";

import { useState } from "react";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Radio from "../form/input/Radio";

export default function ImportContainer() {
  const [path, setPath] = useState("/home/dientuki/Media/Downloads/Liseys-Story");
  const [tmdb, setTmdb] = useState("95839");
  const [season, setSeason] = useState("1");
  const [quality, setQuality] = useState("remux");


  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();

    //setLoading(true);
    //setError(null);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path,
          tmdbId: Number(tmdb),
          season: Number(season),
          quality,
        }),
      });

      if (!res.ok) {
        throw new Error("Error creating import job");
      }

      const data = await res.json();
      //setJobId(data.jobId);
    } catch (err) {
      //setError("No se pudo iniciar el import");
    } finally {
      //setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleImport}>
      <div>
        <Label>Path</Label>
        <div className="relative">
          <Input
            defaultValue={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label>Tmdb</Label>
        <div className="relative">
          <Input
            defaultValue={tmdb}
            onChange={(e) => setTmdb(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label>Season</Label>
        <div className="relative">
          <Input
            defaultValue={season}
            onChange={(e) => setSeason(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label>Quality</Label>
        <div className="relative">asdf</div>
          
        <div className="relative flex gap-4">
          <Radio
            id="remux"
            name="quality"
            value="remux"
            label="Remux"
            checked={quality === "remux"}
            onChange={setQuality}
          />
          <Radio
            id="web"
            name="quality"
            value="web"
            label="Web"
            checked={quality === "web"}
            onChange={setQuality}
          />
        </div>
      </div>
      <button type="submit">Import</button>
    </form>
    </>
  );
}
