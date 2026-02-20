import { useState } from "react";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { EnvelopeIcon } from "../../icons";


export default function SearchForm({ onSearch }) {
  const [query, setQuery] = useState("bajame la ultima de mision imposible");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <Label>Search</Label>
        <div className="relative">
          <Input
            onChange={(e) => setQuery(e.target.value)}
            className="pl-[62px]"
          />
          <span className="absolute left-0 top-1/2 -translate-y-1/2 border-r border-gray-200 px-3.5 py-3 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <EnvelopeIcon />
          </span>
        </div>
      </div>
      <button type="submit">Buscar</button>
    </form>
  );
}
