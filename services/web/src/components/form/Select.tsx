import React, { FC } from "react";

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

// Mismas clases que InputField.tsx (h-11 w-full rounded-lg border ...
// shadow-theme-xs ... dark:bg-gray-900) para que ambos controles se vean
// iguales en el mismo form. A diferencia de components/form/input/Checkbox.tsx
// (sin `name`, por eso SettingsForm usa un <input type="checkbox"> crudo),
// este SÍ lleva `name` — es lo que lo hace usable dentro de un <form action>.
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
  const selectClasses = `h-11 w-full rounded-lg border appearance-none px-4 py-2.5 text-sm shadow-theme-xs focus:outline-hidden focus:ring-3 bg-transparent text-gray-800 border-gray-300 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800 ${
    disabled ? "text-gray-500 border-gray-300 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" : ""
  } ${className}`;

  return (
    <select
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      disabled={disabled}
      className={selectClasses}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default Select;
