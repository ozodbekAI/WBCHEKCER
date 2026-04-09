;

import * as React from "react";

type Option<T extends string> = {
  value: T;
  label: string;
};

export function SegmentedControl<T extends string>(props: {
  value: T;
  onValueChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
}) {
  const { value, onValueChange, options, className } = props;

  return (
    <div
      className={
        "inline-flex items-stretch rounded-full border border-border bg-background p-1 shadow-sm " + (className || "")
      }
      role="tablist"
      aria-label="segmented"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onValueChange(opt.value)}
            className={
              "px-4 py-2 text-sm rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")
            }
            role="tab"
            aria-selected={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
