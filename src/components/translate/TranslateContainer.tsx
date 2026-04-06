"use client";

import { useState } from "react";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Radio from "../form/input/Radio";

export default function TranslateContainer() {
  const [file, setFile] = useState("");


  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();

    //setLoading(true);
    //setError(null);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file,
        }),
      });

      if (!res.ok) {
        throw new Error("Error creating translation job");
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
            defaultValue={file}
            onChange={(e) => setFile(e.target.value)}
          />
        </div>
      </div>
      
      
      <button type="submit">Translate</button>
    </form>
    </>
  );
}
