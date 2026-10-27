"use client";
import { ChevronDown } from "lucide-react";
import type React from "react";
import { type FC, useEffect, useId, useRef, useState } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  className?: string;
  disabled?: boolean;
}

const Select: FC<SelectProps> = ({
  id,
  name,
  value,
  defaultValue,
  options,
  onChange,
  className = "",
  disabled = false,
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [current, setCurrent] = useState(
    value ?? defaultValue ?? options[0]?.value ?? "",
  );
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (value !== undefined) setCurrent(value);
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isOpen]);

  const selectedIndex = options.findIndex((o) => o.value === current);
  const selectedLabel = options[selectedIndex]?.label ?? "";

  // The native <select> stays in the DOM, hidden, as the form-value carrier and
  // the source of a real ChangeEvent: the popup of a native <select> is drawn by
  // the browser and ignored the app's colours, leaving the options unreadable.
  const choose = (next: string) => {
    setIsOpen(false);
    setCurrent(next);
    const native = nativeRef.current;
    if (!native || native.value === next) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(native, next);
    native.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const open = () => {
    setActive(Math.max(selectedIndex, 0));
    setIsOpen(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!isOpen) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[active].value);
    } else if (event.key === "Escape" || event.key === "Tab") {
      setIsOpen(false);
    }
  };

  const buttonClasses = `h-11 w-full rounded-lg border px-4 py-2.5 text-left shadow-theme-xs focus:outline-hidden focus:ring-3 bg-transparent text-gray-800 border-gray-300 focus:border-brand-300 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800 ${
    disabled
      ? "text-gray-500 border-gray-300 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
      : ""
  } ${className}`;

  return (
    <div className="relative" ref={rootRef}>
      <select
        ref={nativeRef}
        name={name}
        value={current}
        onChange={onChange ?? (() => {})}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={handleKeyDown}
        className={buttonClasses}
      >
        <span className="block truncate">{selectedLabel}</span>
      </button>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
        <ChevronDown
          size={18}
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </span>
      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === current}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
              className={`cursor-pointer px-4 py-2 text-gray-800 dark:text-gray-100 ${
                index === active ? "bg-gray-100 dark:bg-white/10" : ""
              } ${option.value === current ? "font-medium" : ""}`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Select;
