"use client";

export type SegmentedControlOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
};

export function SegmentedControl({
  options,
  value,
  onChange,
}: SegmentedControlProps) {
  return (
    <div
      aria-label="分段选项"
      className="inline-flex rounded-[var(--radius-md)] bg-[var(--surface-muted)] p-1"
      role="group"
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            aria-pressed={selected}
            className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-orange)] ${
              selected
                ? "bg-[var(--surface-solid)] text-[var(--text-primary)] shadow-[var(--shadow-card)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            disabled={option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
