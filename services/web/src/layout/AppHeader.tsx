"use client";
import { Menu, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";
import { useEffect, useRef } from "react";
import type { CurrentUser } from "@/actions/auth";
import UserDropdown from "@/components/header/UserDropdown";
import { useSidebar } from "@/context/SidebarContext";

interface AppHeaderProps {
  user: CurrentUser;
}

const AppHeader: React.FC<AppHeaderProps> = ({ user }) => {
  const t = useTranslations("header");
  const router = useRouter();

  const { isMobileOpen, toggleMobileSidebar } = useSidebar();

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <header className="sticky top-0 flex w-full bg-white border-gray-200 z-99999 dark:border-gray-800 dark:bg-gray-900 lg:border-b">
      <div className="flex w-full items-center gap-3 px-3 py-3 sm:gap-4 lg:px-6 lg:py-4">
        <button
          type="button"
          className="flex items-center justify-center w-10 h-10 text-gray-500 border-gray-200 rounded-lg z-99999 dark:border-gray-800 dark:text-gray-400 lg:hidden"
          onClick={toggleMobileSidebar}
          aria-label={t("toggleSidebar")}
        >
          {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        <form
          className="flex-grow"
          onSubmit={(e) => {
            e.preventDefault();
            const query = new FormData(e.currentTarget).get("q");
            const value = typeof query === "string" ? query : "";
            router.push(`/search?q=${encodeURIComponent(value)}`);
          }}
        >
          <div className="relative">
            <span className="absolute -translate-y-1/2 left-4 top-1/2 pointer-events-none">
              <Search className="text-gray-500 dark:text-gray-400" size={20} />
            </span>
            <input
              ref={inputRef}
              type="text"
              name="q"
              placeholder={t("searchPlaceholder")}
              className="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-12 pr-14 text-base text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-gray-900 dark:bg-white/[0.03] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
            />

            <span className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-[7px] py-[4.5px] text-xs -tracking-[0.2px] text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400 sm:inline-flex">
              <span> ⌘ </span>
              <span> K </span>
            </span>
          </div>
        </form>

        <UserDropdown user={user} />
      </div>
    </header>
  );
};

export default AppHeader;
