"use client";

interface Props {
  onSearch: (query: string) => void;
  loading: boolean;
  type: string;
}

export function SearchInput({ onSearch, loading, type }: Props) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const query = formData.get("query") as string;
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center gap-3">
      <div className="relative flex-1">
        <input
          name="query"
          type="text"
          placeholder={`Buscar ${type === "tv" ? "serie" : "película"}...`}
          className="w-full rounded-lg border border-gray-300 bg-transparent py-3 pl-4 pr-10 text-black outline-none focus:border-primary dark:border-gray-700 dark:text-white"
        />
      </div>
      
      <button
        type="submit"
        disabled={loading}
        className="flex items-center justify-center rounded-lg bg-primary px-6 py-3 font-medium text-white hover:bg-opacity-90 disabled:bg-opacity-50"
      >
        {loading ? "Buscando..." : "Buscar"}
      </button>
    </form>
  );
}