"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Check, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  countryFlagEmoji,
  getCountryOption,
  listCountries,
  type CountryOption,
} from "@/lib/expert-countries";
import { cn } from "@/lib/utils";

interface CountryMultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Render a compact summary chip strip (used on the profile card). */
  compact?: boolean;
  dropdownSide?: "top" | "bottom";
  className?: string;
}

export function CountryMultiSelect({
  value,
  onChange,
  placeholder = "Search a country or region...",
  compact = false,
  dropdownSide = "bottom",
  className,
}: CountryMultiSelectProps) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  const all = useMemo(() => listCountries(), []);
  const selected = useMemo(
    () =>
      value
        .map((code) => getCountryOption(code))
        .filter((opt): opt is CountryOption => Boolean(opt)),
    [value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) =>
      [c.code, c.name, c.nameZh, ...c.searchTerms].some((term) =>
        term.toLowerCase().includes(q),
      ),
    );
  }, [all, query]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (event: PointerEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler, { capture: true });
    return () => document.removeEventListener("pointerdown", handler, { capture: true });
  }, [open]);

  const toggle = (code: string) => {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code]);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative space-y-2", className)}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((opt) => (
            <Badge
              key={opt.code}
              variant="secondary"
              className="gap-1.5 border-indigo-400/30 bg-indigo-500/10 text-indigo-100"
            >
              <span aria-hidden>{countryFlagEmoji(opt.code)}</span>
              <span>{opt.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(opt.code);
                }}
                aria-label={`Remove ${opt.name}`}
                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-500/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={cn("pl-9", compact ? "min-h-[40px]" : "min-h-[44px]")}
        />

        {open && (
          <div
            className={cn(
              "absolute left-0 z-20 max-h-64 w-full overflow-y-auto rounded-xl border border-border/60 bg-card/95 p-1 shadow-lg backdrop-blur",
              dropdownSide === "top" ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No matches. Try a different keyword.
              </div>
            ) : (
              filtered.map((c) => {
                const checked = value.includes(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => toggle(c.code)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      checked
                        ? "bg-indigo-500/15 text-foreground"
                        : "text-foreground/90 hover:bg-muted/60",
                    )}
                  >
                    <span className="text-lg leading-none" aria-hidden>
                      {countryFlagEmoji(c.code)}
                    </span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.code}</span>
                    {checked && <Check className="h-4 w-4 text-indigo-400" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface CountryFlagListProps {
  codes: string[];
  className?: string;
  emptyText?: string;
}

/** Read-only flag + name strip used on the public profile + profile preview. */
export function CountryFlagList({ codes, className, emptyText }: CountryFlagListProps) {
  const items = codes
    .map((code) => getCountryOption(code))
    .filter((opt): opt is CountryOption => Boolean(opt));

  if (items.length === 0) {
    return emptyText ? (
      <p className="text-xs text-muted-foreground">{emptyText}</p>
    ) : null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((opt) => (
        <span
          key={opt.code}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-card/40 px-2.5 py-1 text-xs text-foreground/90"
        >
          <span className="text-base leading-none" aria-hidden>
            {countryFlagEmoji(opt.code)}
          </span>
          {opt.name}
        </span>
      ))}
    </div>
  );
}
