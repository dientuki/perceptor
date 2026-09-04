"use client";

import { useSidebar } from "@/context/SidebarContext";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import React from "react";
import type { CurrentUser } from "@/actions/auth";
import type { MediaCapabilities } from "@/types/media";

interface AdminShellProps {
  user: CurrentUser;
  capabilities: MediaCapabilities;
  children: React.ReactNode;
}

export default function AdminShell({
  user,
  capabilities,
  children,
}: AdminShellProps) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  // Dynamic class for main content margin based on sidebar state
  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
      ? "lg:ml-[290px]"
      : "lg:ml-[90px]";

  return (
    <div className="min-h-screen xl:flex">
      {/* Sidebar and Backdrop */}
      <AppSidebar isAdmin={user.isAdmin} capabilities={capabilities} />
      <Backdrop />
      {/* Main Content Area */}
      <div
        className={`flex-1 min-w-0 transition-all  duration-300 ease-in-out ${mainContentMargin}`}
      >
        {/* Header */}
        <AppHeader user={user} capabilities={capabilities} />
        {/* Page Content */}
        <div className="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
