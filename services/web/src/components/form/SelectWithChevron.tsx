import { ChevronDown } from "lucide-react";
import type { FC } from "react";
import Select from "@/components/form/Select";

// Wraps the existing appearance-none Select with a positioned chevron so the
// browser's native arrow never shows (REQ-2, 044-settings-screen-polish).
// Every prop passes through to Select untouched — this component adds no
// behaviour, only the chevron affordance layered over it.
type SelectWithChevronProps = React.ComponentProps<typeof Select>;

const SelectWithChevron: FC<SelectWithChevronProps> = (props) => {
  return (
    <div className="relative">
      <Select {...props} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
        <ChevronDown size={18} />
      </span>
    </div>
  );
};

export default SelectWithChevron;
