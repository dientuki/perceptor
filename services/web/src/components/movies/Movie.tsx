"use client";
import { FileVideo, Magnet } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { setMoviePreferredLanguagesAction } from "@/actions/languages";
import type { Movie as MovieRecord } from "@/actions/movies";
import ImportFileModal from "@/components/import/importFileModal";
import ImportMagnetModal from "@/components/import/importMagnetModal";
import LanguagePicker from "@/components/media/LanguagePicker";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type { Language } from "@/types/languages";
import type { AcquisitionTarget } from "@/types/media";

export default function Movie({
  movie,
  languageOptions,
}: {
  movie: MovieRecord;
  languageOptions: Language[];
}) {
  const t = useTranslations("movies.detail");
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
  const target: AcquisitionTarget = { kind: "movie", movie };
  const setMoviePreferredLanguages = setMoviePreferredLanguagesAction.bind(
    null,
    movie.id,
  );

  return (
    <div className="flex flex-col gap-8 md:flex-row">
      {/* Poster a la izquierda */}
      <div className="w-full shrink-0 md:w-64 lg:w-72">
        {movie.posterUrl ? (
          // El posterUrl del api es w300 (300px de ancho); pedir más grande lo escala y se ve borroso
          <Image
            src={movie.posterUrl}
            alt={movie.title}
            width={300}
            height={450}
            className="rounded-xl shadow-md"
            priority
          />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <span className="text-gray-400 italic">{t("noPoster")}</span>
          </div>
        )}
      </div>

      {/* Información a la derecha */}
      <div className="flex-1 space-y-6">
        <div>
          <h3 className="mb-2 text-2xl font-bold text-gray-800 dark:text-white/90">
            {movie.title}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {movie.releaseDate
              ? new Date(movie.releaseDate).getFullYear()
              : t("unknownYear")}{" "}
            • {movie.originalLanguage.toUpperCase()} • {movie.status}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button size="sm" variant="outline" onClick={openFileModal}>
            <FileVideo size={18} />
            {t("fileButton")}
          </Button>
          <Button size="sm" variant="outline" onClick={openMagnetModal}>
            <Magnet size={18} className="text-red-500" />
            {t("magnetButton")}
          </Button>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            {t("synopsisTitle")}
          </h4>
          <p className="text-gray-600 dark:text-gray-300 leading-relaxed italic">
            {movie.overview || t("noOverview")}
          </p>
        </div>

        <div className="space-y-2 max-w-lg">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            {t("languagesTitle")}
          </h4>
          <LanguagePicker
            options={languageOptions}
            selected={movie.preferredLanguages}
            action={setMoviePreferredLanguages}
          />
        </div>
      </div>

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
    </div>
  );
}
