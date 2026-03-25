"use client";

import { Prisma, MediaType, Episode } from "@prisma/client";
import { useState } from "react";
import { FileVideo, Magnet } from "lucide-react";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import ImportFileModal from "@/components/import/importFileModal";
import ImportMagnetModal from "@/components/import/ImportMagnetModal";

type SeasonWithEpisodes = Prisma.SeasonGetPayload<{
  include: {
    episodes: true; // This includes all scalar fields from Episode
  };
}>;

interface SeasonAccordionProps {
  season: SeasonWithEpisodes;
  defaultOpen?: boolean;
}

export const SeasonAccordion = ({ season, defaultOpen = false }: SeasonAccordionProps) => {
  const [ isSeasonOpen, setIsSeasonOpen] = useState(defaultOpen);
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null);
  const { isOpen: isFileModalOpen, openModal: openFileModal, closeModal: closeFileModal } = useModal();
  const { isOpen: isMagnetModalOpen, openModal: openMagnetModal, closeModal: closeMagnetModal } = useModal();

  const handleOpenFileModal = (episode: Episode) => {
    setActiveEpisode(episode);
    openFileModal();
  };

  const handleOpenMagnetModal = (episode: Episode) => {
    setActiveEpisode(episode);
    openMagnetModal();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <button
        onClick={() => setIsSeasonOpen(!isSeasonOpen)}
        className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 text-left transition hover:bg-gray-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]"
      >
        <h4 className="font-semibold text-gray-800 dark:text-white/90">
          Season {season.seasonNumber}
        </h4>
        <span className={`transform transition-transform duration-200 ${isSeasonOpen ? "rotate-180" : ""}`}>
          <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      
      {isSeasonOpen && (
        <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-800">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-white/[0.02]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400">Release Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-transparent">
              {season.episodes.map((episode) => (
                <tr key={episode.id}>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{episode.episodeNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    <div className="font-medium">{episode.title || `Episode ${episode.episodeNumber}`}</div>
                    {episode.overview && <div className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{episode.overview}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-700 dark:text-gray-300">
                    {episode.releaseDate ? new Date(episode.releaseDate).toLocaleDateString("es-ES") : "-"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${episode.downloaded ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400" : "bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400"}`}>
                      {episode.downloaded ? "Downloaded" : "Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleOpenFileModal(episode)}>
                        <FileVideo className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleOpenMagnetModal(episode)}>
                        <Magnet className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ImportFileModal 
        isOpen={isFileModalOpen} 
        onClose={closeFileModal} 
        item={activeEpisode} 
        mediaType={MediaType.TV}
      />
      <ImportMagnetModal
        isOpen={isMagnetModalOpen}
        onClose={closeMagnetModal}
        item={activeEpisode}
        mediaType={MediaType.TV}
      />
    </div>
    
  );
};
