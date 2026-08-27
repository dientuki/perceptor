import type { ReactNode } from "react";

interface BreadcrumbProps {
  pageTitle: string;
  children?: ReactNode;
}

function PageBreadcrumb({ pageTitle, children }: BreadcrumbProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h2
        className="text-xl font-semibold text-gray-800 dark:text-white/90"
        x-text="pageName"
      >
        {pageTitle}
      </h2>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

export default PageBreadcrumb;
