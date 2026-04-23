type ServiceItem = {
  title?: string;
  description?: string;
};

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseServicesOffered(raw: unknown): ServiceItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") {
          return {
            title: trimString(item) ?? undefined,
            description: undefined,
          };
        }
        const record = item as Record<string, unknown>;
        return {
          title: trimString(record.title) ?? undefined,
          description: trimString(record.description) ?? undefined,
        };
      })
      .filter((item) => item.title || item.description);
  }

  if (typeof raw === "string") {
    try {
      return parseServicesOffered(JSON.parse(raw));
    } catch {
      const text = trimString(raw);
      return text ? [{ title: text }] : [];
    }
  }

  return [];
}

export function serviceTitles(raw: unknown): string[] {
  return parseServicesOffered(raw)
    .map((item) => item.title)
    .filter((title): title is string => Boolean(title));
}

export function stringifyServicesOffered(raw: unknown): string {
  const items = parseServicesOffered(raw);
  if (items.length === 0) {
    return "";
  }

  return items
    .map((item) => {
      if (item.title && item.description) {
        return `${item.title}: ${item.description}`;
      }
      return item.title ?? item.description ?? "";
    })
    .filter(Boolean)
    .join(" | ");
}

export function legacyExpertDomains(): string[] {
  return [];
}

export function buildExpertSearchText(input: {
  name?: string | null;
  nickName?: string | null;
  bio?: string | null;
  servicesOffered?: unknown;
}): string {
  return [
    input.nickName,
    input.name,
    input.bio,
    stringifyServicesOffered(input.servicesOffered),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesExpertTopics(
  input: {
    name?: string | null;
    nickName?: string | null;
    bio?: string | null;
    servicesOffered?: unknown;
  },
  topics: string[],
): boolean {
  if (topics.length === 0) {
    return true;
  }

  const haystack = buildExpertSearchText(input);
  return topics.some((topic) => haystack.includes(topic.toLowerCase()));
}

export function buildExpertFocusLabel(input: {
  bio?: string | null;
  servicesOffered?: unknown;
}): string | null {
  const titles = serviceTitles(input.servicesOffered);
  if (titles.length > 0) {
    return titles.join(", ");
  }

  const bio = trimString(input.bio);
  if (!bio) {
    return null;
  }

  const sentence = bio.split(/[.!?]\s/)[0] ?? bio;
  return sentence.slice(0, 120);
}
