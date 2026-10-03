"use client";

import {
  Calendar,
  Clapperboard,
  CloudDownload,
  Film,
  Popcorn,
  Rocket,
  Settings,
  Tv,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import type { IndexerStatus } from "@/types/indexer";
import type { MediaCapabilities } from "@/types/media";
import { useSidebar } from "../context/SidebarContext";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  badge?: number;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

interface AppSidebarProps {
  isAdmin?: boolean;
  capabilities: MediaCapabilities;
  activeDownloadCount?: number;
  indexerStatus?: IndexerStatus | null;
}

const AppSidebar: React.FC<AppSidebarProps> = ({
  isAdmin = false,
  capabilities,
  activeDownloadCount = 0,
  indexerStatus = null,
}) => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  const t = useTranslations("nav");

  const baseNavItems: NavItem[] = [
    {
      icon: <Popcorn />,
      name: t("billboard"),
      path: "/",
    },
    ...(capabilities.moviesEnabled
      ? [
          {
            icon: <Film />,
            name: t("movies"),
            path: "/movies",
          },
        ]
      : []),
    ...(capabilities.shortsEnabled
      ? [
          {
            icon: <Clapperboard />,
            name: t("shorts"),
            path: "/shorts",
          },
        ]
      : []),
    ...(capabilities.showsEnabled
      ? [
          {
            icon: <Tv />,
            name: t("shows"),
            path: "/shows",
          },
        ]
      : []),
    {
      icon: <Calendar />,
      name: t("calendar"),
      path: "/calendar",
    },
    {
      icon: <CloudDownload />,
      name: t("downloads"),
      path: "/downloads",
      badge: activeDownloadCount,
    },
  ];

  // Spec 029, REQ-11; Spec 078, REQ-2
  const showFirstStep =
    !capabilities.catalogKeyConfigured ||
    (indexerStatus?.configuredIndexers ?? 0) === 0;

  const navItems: NavItem[] = isAdmin
    ? [
        ...baseNavItems,
        //icon: <UserCircleIcon />,
        { icon: <Settings />, name: t("settings"), path: "/settings" },
        { icon: <Users />, name: t("users"), path: "/users" },
        ...(showFirstStep
          ? [{ icon: <Rocket />, name: t("firstStep"), path: "/first-step" }]
          : []),
      ]
    : baseNavItems;

  const renderMenuItems = (
    navItems: NavItem[],
    menuType: "main" | "others",
  ) => (
    <ul className="flex flex-col gap-4">
      {navItems.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group  ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={` ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className={`menu-item-text`}>{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <span
                  className={`menu-item-dropdown-icon ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-90"
                      : ""
                  }`}
                >
                  a
                </span>
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`relative ${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                  {nav.badge != null &&
                    nav.badge > 0 &&
                    !(isExpanded || isHovered || isMobileOpen) && (
                      <span
                        role="img"
                        aria-label={t("downloadsBadge", { count: nav.badge })}
                        className="absolute -top-2 -right-2"
                      >
                        <Badge color="primary" variant="solid" size="sm">
                          {nav.badge}
                        </Badge>
                      </span>
                    )}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className={`menu-item-text`}>{nav.name}</span>
                )}
                {nav.badge != null &&
                  nav.badge > 0 &&
                  (isExpanded || isHovered || isMobileOpen) && (
                    <span
                      role="img"
                      aria-label={t("downloadsBadge", { count: nav.badge })}
                      className="ml-auto"
                    >
                      <Badge color="primary" variant="solid" size="sm">
                        {nav.badge}
                      </Badge>
                    </span>
                  )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge `}
                          >
                            new
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {},
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // const isActive = (path: string) => path === pathname;
  const isActive = useCallback((path: string) => path === pathname, [pathname]);

  useEffect(() => {
    // Check if the current path matches any submenu item
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = navItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

    // If no submenu item matches, close the open submenu
    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
  }, [pathname, isActive]);

  useEffect(() => {
    // Set the height of the submenu items when the submenu is opened
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[250px]"
            : isHovered
              ? "w-[250px]"
              : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`-mx-5 mb-4 flex h-19 shrink-0 items-center px-5 ${
          !isExpanded && !isHovered && !isMobileOpen
            ? "lg:justify-center"
            : "justify-start"
        }`}
      >
        <Link
          href="/"
          className="font-[family-name:var(--font-inter)] text-[36px] leading-none font-black tracking-tight text-gray-900 dark:text-white"
        >
          {isExpanded || isHovered || isMobileOpen ? "Perceptor" : "P"}
        </Link>
      </div>
      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            {renderMenuItems(navItems, "main")}
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
