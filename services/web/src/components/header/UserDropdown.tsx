"use client";
import { LogOut, Moon, Settings2, Sun, UserPen } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type React from "react";
import { useState } from "react";
import type { CurrentUser } from "@/actions/auth";
import { logoutAction } from "@/actions/auth";
import ProfileModal from "@/components/profile/ProfileModal";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import { useTheme } from "@/context/ThemeContext";

interface UserDropdownProps {
  user: CurrentUser;
}

export default function UserDropdown({ user }: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const t = useTranslations("userMenu");
  const tCommon = useTranslations("common");
  const { theme, toggleTheme } = useTheme();

  function toggleDropdown(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  }

  function closeDropdown() {
    setIsOpen(false);
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleDropdown}
        aria-label={tCommon("userMenuLabel")}
        className="flex items-center text-gray-700 dark:text-gray-400 dropdown-toggle"
      >
        <span className="overflow-hidden rounded-full h-11 w-11">
          <Image
            width={44}
            height={44}
            src="/images/avatar.png"
            alt={tCommon("altUser")}
          />
        </span>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="absolute right-0 mt-[17px] flex w-[260px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark"
      >
        <div>
          <span className="block font-medium text-gray-700 dark:text-gray-400">
            {user.name}
          </span>
        </div>

        <ul className="flex flex-col gap-1 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
          <li>
            <DropdownItem
              onItemClick={() => {
                closeDropdown();
                setIsProfileOpen(true);
              }}
              className="flex items-center gap-3 px-3 py-2 font-medium text-gray-700 rounded-lg group hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <UserPen size={18} />
              {t("editProfile")}
            </DropdownItem>
          </li>
          <li>
            <DropdownItem
              onItemClick={closeDropdown}
              tag="a"
              href="/settings"
              className="flex items-center gap-3 px-3 py-2 font-medium text-gray-700 rounded-lg group hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <Settings2 size={18} />
              {t("settings")}
            </DropdownItem>
          </li>
          <li>
            <DropdownItem
              onClick={toggleTheme}
              onItemClick={closeDropdown}
              className="flex items-center gap-3 px-3 py-2 font-medium text-gray-700 rounded-lg group hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              {theme === "light" ? (
                <>
                  <Moon size={18} />
                  {t("themeDark")}
                </>
              ) : (
                <>
                  <Sun size={18} />
                  {t("themeLight")}
                </>
              )}
            </DropdownItem>
          </li>
        </ul>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex items-center w-full gap-3 px-3 py-2 mt-3 font-medium text-gray-700 rounded-lg group hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
          >
            <LogOut size={18} />
            {t("signOut")}
          </button>
        </form>
      </Dropdown>

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        user={user}
      />
    </div>
  );
}
