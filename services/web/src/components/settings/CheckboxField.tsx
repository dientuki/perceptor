"use client";

import { useState } from "react";
import Checkbox from "@/components/form/input/Checkbox";

interface CheckboxFieldProps {
  name: string;
  label: string;
  defaultChecked: boolean;
}

// Checkbox.tsx is controlled and renders no `name`d input a <form> can read
// — same idiom PathPicker uses for its own controlled value: local state for
// the visible control, one hidden input beside it carrying the value
// updateSettingsAction's BOOLEAN_KEYS treatment expects ('true'/'false').
export default function CheckboxField({
  name,
  label,
  defaultChecked,
}: CheckboxFieldProps) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={name}
        checked={checked}
        onChange={setChecked}
        label={label}
      />
      <input type="hidden" name={name} value={checked ? "true" : "false"} />
    </div>
  );
}
