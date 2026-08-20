import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Download, Film, Search, Server } from "lucide-react";

export default async function Home() {
  const t = await getTranslations("landing");
  const tCommon = await getTranslations("common");

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="absolute top-1/2 -left-40 h-96 w-96 rounded-full bg-blue-light-400/20 blur-3xl" />
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center gap-12 px-6 py-16 lg:flex-row lg:gap-8 lg:py-0">
        <div className="flex w-full flex-col items-center text-center lg:w-1/2 lg:items-start lg:text-left">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-theme-xs font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            {t("badge")}
          </span>

          <h1 className="text-title-md font-bold text-gray-800 dark:text-white/90 sm:text-title-lg">
            {tCommon("appName")}
          </h1>

          <p className="mt-4 max-w-lg text-theme-xl text-gray-500 dark:text-gray-400">
            {t("description")}
          </p>

          <div className="mt-8 flex w-full max-w-lg flex-wrap justify-center gap-3 lg:justify-start">
            <Feature
              icon={<Search className="size-5" />}
              label={t("features.search")}
            />
            <Feature
              icon={<Download className="size-5" />}
              label={t("features.download")}
            />
            <Feature
              icon={<Film className="size-5" />}
              label={t("features.transcode")}
            />
            <Feature
              icon={<Server className="size-5" />}
              label={t("features.organize")}
            />
          </div>

          <Link
            href="/login"
            className="mt-10 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-6 py-3.5 text-theme-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600"
          >
            {t("cta")}
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="w-full lg:w-1/2">
          <PerceptorIllustration
            className="mx-auto h-auto w-full max-w-md drop-shadow-2xl"
            alt={t("illustrationAlt")}
          />
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-[150px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-theme-sm font-medium text-gray-700 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
      <span className="text-brand-500 dark:text-brand-400">{icon}</span>
      {label}
    </div>
  );
}

/**
 * Ilustración original inspirada en un robot transformable estilo G1,
 * en modo microscopio/tanque, como guiño decorativo al nombre del proyecto.
 * No reproduce el diseño registrado de ningún personaje.
 */
function PerceptorIllustration({
  className,
  alt,
}: {
  className?: string;
  alt: string;
}) {
  return (
    <svg
      viewBox="0 0 400 400"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={alt}
    >
      <defs>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7592ff" />
          <stop offset="100%" stopColor="#3641f5" />
        </linearGradient>
        <linearGradient id="headGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9cb9ff" />
          <stop offset="100%" stopColor="#465fff" />
        </linearGradient>
        <radialGradient id="lensGrad" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="55%" stopColor="#36bffa" />
          <stop offset="100%" stopColor="#026aa2" />
        </radialGradient>
      </defs>

      {/* sombra */}
      <ellipse
        cx="200"
        cy="365"
        rx="120"
        ry="14"
        fill="#101828"
        opacity="0.12"
      />

      {/* piernas */}
      <rect x="140" y="280" width="34" height="70" rx="6" fill="#344054" />
      <rect x="226" y="280" width="34" height="70" rx="6" fill="#344054" />
      <rect x="132" y="340" width="50" height="20" rx="5" fill="#1d2939" />
      <rect x="218" y="340" width="50" height="20" rx="5" fill="#1d2939" />

      {/* torso */}
      <rect
        x="115"
        y="165"
        width="170"
        height="125"
        rx="18"
        fill="url(#bodyGrad)"
      />
      <rect
        x="115"
        y="165"
        width="170"
        height="125"
        rx="18"
        fill="none"
        stroke="#252dae"
        strokeWidth="3"
      />

      {/* panel de pecho */}
      <rect
        x="150"
        y="195"
        width="100"
        height="60"
        rx="10"
        fill="#dde9ff"
        opacity="0.9"
      />
      <rect x="160" y="205" width="80" height="8" rx="4" fill="#3641f5" />
      <rect
        x="160"
        y="219"
        width="55"
        height="8"
        rx="4"
        fill="#3641f5"
        opacity="0.7"
      />
      <rect
        x="160"
        y="233"
        width="65"
        height="8"
        rx="4"
        fill="#3641f5"
        opacity="0.5"
      />

      {/* brazos */}
      <rect x="70" y="175" width="38" height="95" rx="14" fill="#465fff" />
      <rect x="292" y="175" width="38" height="95" rx="14" fill="#465fff" />
      <circle cx="89" cy="275" r="18" fill="#252dae" />
      <circle cx="311" cy="275" r="18" fill="#252dae" />

      {/* hombros */}
      <circle cx="118" cy="178" r="22" fill="#2a31d8" />
      <circle cx="282" cy="178" r="22" fill="#2a31d8" />

      {/* cuello */}
      <rect x="185" y="140" width="30" height="30" fill="#3641f5" />

      {/* cabeza */}
      <rect
        x="155"
        y="70"
        width="90"
        height="80"
        rx="16"
        fill="url(#headGrad)"
      />
      <rect
        x="155"
        y="70"
        width="90"
        height="80"
        rx="16"
        fill="none"
        stroke="#252dae"
        strokeWidth="3"
      />

      {/* visor/ojos */}
      <rect x="170" y="98" width="60" height="14" rx="7" fill="#0b4a6f" />
      <rect x="176" y="101" width="20" height="8" rx="4" fill="#7cd4fd" />
      <rect x="204" y="101" width="20" height="8" rx="4" fill="#7cd4fd" />

      {/* antenas tipo "microscopio" homenajeando el modo alterno del personaje */}
      <line
        x1="170"
        y1="70"
        x2="150"
        y2="35"
        stroke="#344054"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <line
        x1="230"
        y1="70"
        x2="250"
        y2="35"
        stroke="#344054"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle
        cx="150"
        cy="30"
        r="10"
        fill="url(#lensGrad)"
        stroke="#065986"
        strokeWidth="2"
      />
      <circle
        cx="250"
        cy="30"
        r="10"
        fill="url(#lensGrad)"
        stroke="#065986"
        strokeWidth="2"
      />

      {/* lente central en el pecho, como guiño al "modo microscopio" */}
      <circle
        cx="200"
        cy="180"
        r="16"
        fill="url(#lensGrad)"
        stroke="#065986"
        strokeWidth="3"
      />
    </svg>
  );
}
