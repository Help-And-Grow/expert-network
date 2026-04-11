"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Loader2, MapPin } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Match server `/api/places/autocomplete` minimum. */
export const ADDRESS_AUTOCOMPLETE_MIN_CHARS = 4;

const DEBOUNCE_MS = 280;

type Suggestion = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
};

export function AddressAutocompleteInput({
  id,
  value,
  onChange,
  placeholder,
  className,
  disabled,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}) {
  const listId = useId();
  const sessionTokenRef = useRef(
    typeof crypto !== "undefined" ? crypto.randomUUID() : `sess-${Date.now()}`,
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const refreshSession = useCallback(() => {
    sessionTokenRef.current =
      typeof crypto !== "undefined" ? crypto.randomUUID() : `sess-${Date.now()}`;
  }, []);

  const runFetch = useCallback(async (q: string) => {
    if (q.length < ADDRESS_AUTOCOMPLETE_MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/places/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          input: q,
          sessionToken: sessionTokenRef.current,
        }),
      });
      const data = (await res.json()) as {
        configured?: boolean;
        suggestions?: Suggestion[];
      };
      if (typeof data.configured === "boolean") setConfigured(data.configured);
      const list = data.suggestions ?? [];
      setSuggestions(list);
      setOpen(list.length > 0);
      setHighlight(0);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < ADDRESS_AUTOCOMPLETE_MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runFetch(q);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, runFetch]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pickSuggestion = async (s: Suggestion) => {
    setOpen(false);
    setSuggestions([]);
    try {
      const res = await fetch("/api/places/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          placeId: s.placeId,
          sessionToken: sessionTokenRef.current,
        }),
      });
      const data = (await res.json()) as { formattedAddress?: string | null };
      const addr = data.formattedAddress?.trim();
      onChange(addr || s.fullText || s.primaryText);
    } catch {
      onChange(s.fullText || s.primaryText);
    }
    refreshSession();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void pickSuggestion(suggestions[highlight]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          className={cn(loading && "pr-9", className)}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && suggestions[highlight] ? `${listId}-opt-${highlight}` : undefined
          }
          aria-describedby={ariaDescribedBy}
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {suggestions.map((s, i) => (
            <li key={s.placeId} role="presentation">
              <button
                id={`${listId}-opt-${i}`}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  i === highlight && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pickSuggestion(s)}
                onMouseEnter={() => setHighlight(i)}
              >
                <span className="font-medium">{s.primaryText || s.fullText}</span>
                {s.secondaryText ? (
                  <span className="text-xs text-muted-foreground">{s.secondaryText}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {configured === false ? (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          <span>
            Address suggestions need{" "}
            <code className="rounded bg-muted px-1">GOOGLE_PLACES_API_KEY</code> (Places API New).
            You can still type the full address manually.
          </span>
        </p>
      ) : null}
    </div>
  );
}
