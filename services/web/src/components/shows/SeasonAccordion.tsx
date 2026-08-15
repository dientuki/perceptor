"use client";

import { ChevronDown, FileVideo, Magnet, Search } from "lucide-react";
import { useState } from "react";
import type { Episode, Season } from "@/actions/shows";
import ImportFileModal from "@/components/import/importFileModal";
import ImportMagnetModal from "@/components/import/importMagnetModal";
import SearchTorrentModal from "@/components/search/SearchTorrentModal";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type { AcquisitionTarget } from "@/types/media";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "bg-green-500/10 text-green-500";
    case "ERROR":
      return "bg-red-500/10 text-red-500";
    case "MISSING":
      return "bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400";
    default:
      return "animate-pulse bg-blue-500/10 text-blue-500";
  }
}

function EpisodeRow({
  episode,
  onOpenSearchModal,
  onOpenFileModal,
  onOpenMagnetModal,
}: {
  episode: Episode;
  onOpenSearchModal: (episode: Episode) => void;
  onOpenFileModal: (episode: Episode) => void;
  onOpenMagnetModal: (episode: Episode) => void;
}) {
  return (
    <tr>
      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
        {episode.episodeNumber}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
        <div className="font-medium">
          {episode.title || `Episodio ${episode.episodeNumber}`}
        </div>
        {episode.overview && (
          <div className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {episode.overview}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
        {episode.releaseDate
          ? new Date(episode.releaseDate).toLocaleDateString()
          : "-"}
      </td>
      <td className="px-4 py-3 text-sm">
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wider ${statusBadgeClass(
            episode.status,
          )}`}
        >
          {episode.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            title="Buscar"
            onClick={() => onOpenSearchModal(episode)}
          >
            <Search size={16} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            title="Importar archivo"
            onClick={() => onOpenFileModal(episode)}
          >
            <FileVideo size={16} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            title="Añadir torrent"
            onClick={() => onOpenMagnetModal(episode)}
          >
            <Magnet size={16} className="text-red-500" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function SeasonAccordion({
  season,
  defaultOpen,
  showTitle,
}: {
  season: Season;
  defaultOpen: boolean;
  showTitle: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null);

  const {
    isOpen: isFileModalOpen,
    openModal: openFileModal,
    closeModal: closeFileModal,
  } = useModal();
  const {
    isOpen: isMagnetModalOpen,
    openModal: openMagnetModal,
    closeModal: closeMagnetModal,
  } = useModal();
  const {
    isOpen: isSearchModalOpen,
    openModal: openSearchModal,
    closeModal: closeSearchModal,
  } = useModal();

  const handleOpenFileModal = (episode: Episode) => {
    setActiveEpisode(episode);
    openFileModal();
  };

  const handleOpenMagnetModal = (episode: Episode) => {
    setActiveEpisode(episode);
    openMagnetModal();
  };

  const handleOpenSearchModal = (episode: Episode) => {
    setActiveEpisode(episode);
    openSearchModal();
  };

  const target: AcquisitionTarget | null = activeEpisode
    ? {
        kind: "episode",
        episode: activeEpisode,
        showTitle,
        seasonNumber: season.seasonNumber,
      }
    : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Temporada {season.seasonNumber}
        </h4>
        <ChevronDown
          size={20}
          className={`text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-800">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-white/[0.02]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Título
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Fecha de estreno
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Estado
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-transparent">
              {/* Display order only — newest episode first; the underlying array stays in the order the API sent it. */}
              {[...season.episodes].reverse().map((episode) => (
                <EpisodeRow
                  key={episode.id}
                  episode={episode}
                  onOpenSearchModal={handleOpenSearchModal}
                  onOpenFileModal={handleOpenFileModal}
                  onOpenMagnetModal={handleOpenMagnetModal}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImportFileModal
        isOpen={isFileModalOpen}
        onClose={closeFileModal}
        target={target}
      />
      <ImportMagnetModal
        isOpen={isMagnetModalOpen}
        onClose={closeMagnetModal}
        target={target}
      />
      <SearchTorrentModal
        isOpen={isSearchModalOpen}
        onClose={closeSearchModal}
        target={target}
      />
    </div>
  );
}
