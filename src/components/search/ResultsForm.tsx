export default function ResultsForm({
  results,
  selectedIds,
  toggleSelection,
  onProcess,
}) {
  if (results.length === 0) return null;

  return (
    <form
      onSubmit={onProcess}
      className="space-y-4 border-t border-neutral-700 pt-4"
    >
      <div className="space-y-2">
        {results.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-3 p-3 bg-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-600 transition"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={() => toggleSelection(item.id)}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>{item.title || item.name}</span>
          </label>
        ))}
      </div>

      <button
        type="submit"
        className="w-full bg-green-600 hover:bg-green-500 transition p-2 rounded font-semibold"
      >
        Procesar Selección
      </button>
    </form>
  );
}
