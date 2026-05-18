/**
 * Canonical list of country/region codes that an expert can mark as a focus.
 * Stored on Expert.countries as `string[]` of ISO 3166-1 alpha-2 codes
 * (uppercase).  The flag emoji is derived deterministically from the code
 * (regional indicator symbols), so we don't have to ship per-country images.
 *
 * The picker on web + WeChat uses `searchTerms` as a case-insensitive
 * search index — a user can type "中国", "china", "cn", or even "prc"
 * and land on the right entry without a separate translation table.
 *
 * Discover keyword filtering uses the same search terms: when an inbound
 * inquiry mentions a country (e.g. "experts in Singapore"), we shortlist
 * experts whose stored country codes include the matched code.
 */
export interface CountryOption {
  /** ISO 3166-1 alpha-2 code, uppercase. Stored on Expert.countries. */
  code: string;
  /** English display name shown on the public profile. */
  name: string;
  /** Localized name shown in the WeChat (Chinese) UI. */
  nameZh: string;
  /** Lowercased keywords used for picker search and inquiry matching. */
  searchTerms: string[];
}

const COUNTRY_LIST: CountryOption[] = [
  { code: "SG", name: "Singapore", nameZh: "新加坡", searchTerms: ["singapore", "新加坡", "sg", "狮城"] },
  { code: "MY", name: "Malaysia", nameZh: "马来西亚", searchTerms: ["malaysia", "马来西亚", "大马", "my"] },
  { code: "ID", name: "Indonesia", nameZh: "印度尼西亚", searchTerms: ["indonesia", "印尼", "印度尼西亚", "id"] },
  { code: "TH", name: "Thailand", nameZh: "泰国", searchTerms: ["thailand", "泰国", "th"] },
  { code: "VN", name: "Vietnam", nameZh: "越南", searchTerms: ["vietnam", "viet nam", "越南", "vn"] },
  { code: "PH", name: "Philippines", nameZh: "菲律宾", searchTerms: ["philippines", "菲律宾", "ph"] },
  { code: "MM", name: "Myanmar", nameZh: "缅甸", searchTerms: ["myanmar", "burma", "缅甸", "mm"] },
  { code: "KH", name: "Cambodia", nameZh: "柬埔寨", searchTerms: ["cambodia", "柬埔寨", "kh"] },
  { code: "LA", name: "Laos", nameZh: "老挝", searchTerms: ["laos", "lao", "老挝", "寮国"] },
  { code: "BN", name: "Brunei", nameZh: "文莱", searchTerms: ["brunei", "文莱", "bn"] },
  { code: "TL", name: "Timor-Leste", nameZh: "东帝汶", searchTerms: ["timor", "timor-leste", "east timor", "东帝汶"] },
  { code: "CN", name: "Mainland China", nameZh: "中国大陆", searchTerms: ["china", "中国", "中国大陆", "prc", "mainland china", "cn"] },
  { code: "HK", name: "Hong Kong SAR", nameZh: "中国香港", searchTerms: ["hong kong", "hk", "香港", "hong-kong"] },
  { code: "TW", name: "Taiwan", nameZh: "中国台湾", searchTerms: ["taiwan", "台湾", "tw"] },
  { code: "MO", name: "Macao SAR", nameZh: "中国澳门", searchTerms: ["macao", "macau", "澳门"] },
  { code: "JP", name: "Japan", nameZh: "日本", searchTerms: ["japan", "日本", "jp"] },
  { code: "KR", name: "South Korea", nameZh: "韩国", searchTerms: ["korea", "south korea", "韩国", "kr"] },
  { code: "IN", name: "India", nameZh: "印度", searchTerms: ["india", "印度"] },
  { code: "AU", name: "Australia", nameZh: "澳大利亚", searchTerms: ["australia", "澳大利亚", "澳洲", "au"] },
  { code: "NZ", name: "New Zealand", nameZh: "新西兰", searchTerms: ["new zealand", "新西兰", "纽西兰", "nz"] },
  { code: "US", name: "United States", nameZh: "美国", searchTerms: ["united states", "usa", "us", "america", "美国"] },
  { code: "CA", name: "Canada", nameZh: "加拿大", searchTerms: ["canada", "加拿大", "ca"] },
  { code: "GB", name: "United Kingdom", nameZh: "英国", searchTerms: ["united kingdom", "uk", "britain", "england", "英国", "gb"] },
  { code: "IE", name: "Ireland", nameZh: "爱尔兰", searchTerms: ["ireland", "爱尔兰", "ie"] },
  { code: "DE", name: "Germany", nameZh: "德国", searchTerms: ["germany", "德国", "de"] },
  { code: "FR", name: "France", nameZh: "法国", searchTerms: ["france", "法国", "fr"] },
  { code: "NL", name: "Netherlands", nameZh: "荷兰", searchTerms: ["netherlands", "holland", "荷兰", "nl"] },
  { code: "ES", name: "Spain", nameZh: "西班牙", searchTerms: ["spain", "西班牙", "es"] },
  { code: "IT", name: "Italy", nameZh: "意大利", searchTerms: ["italy", "意大利", "it"] },
  { code: "CH", name: "Switzerland", nameZh: "瑞士", searchTerms: ["switzerland", "瑞士", "ch"] },
  { code: "SE", name: "Sweden", nameZh: "瑞典", searchTerms: ["sweden", "瑞典", "se"] },
  { code: "AE", name: "United Arab Emirates", nameZh: "阿联酋", searchTerms: ["uae", "united arab emirates", "dubai", "阿联酋", "迪拜", "ae"] },
  { code: "SA", name: "Saudi Arabia", nameZh: "沙特阿拉伯", searchTerms: ["saudi arabia", "saudi", "沙特", "沙特阿拉伯"] },
  { code: "IL", name: "Israel", nameZh: "以色列", searchTerms: ["israel", "以色列", "il"] },
  { code: "BR", name: "Brazil", nameZh: "巴西", searchTerms: ["brazil", "brasil", "巴西", "br"] },
  { code: "MX", name: "Mexico", nameZh: "墨西哥", searchTerms: ["mexico", "墨西哥", "mx"] },
  { code: "ZA", name: "South Africa", nameZh: "南非", searchTerms: ["south africa", "南非", "za"] },
  { code: "NG", name: "Nigeria", nameZh: "尼日利亚", searchTerms: ["nigeria", "尼日利亚", "ng"] },
  { code: "EG", name: "Egypt", nameZh: "埃及", searchTerms: ["egypt", "埃及", "eg"] },
];

const CODE_TO_OPTION = new Map<string, CountryOption>(
  COUNTRY_LIST.map((c) => [c.code, c]),
);

export function listCountries(): CountryOption[] {
  return COUNTRY_LIST;
}

export function isCountryCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CODE_TO_OPTION.has(value.trim().toUpperCase())
  );
}

/** Coerce a stored value (DB JSON, request body) into a deduped, valid code list. */
export function normalizeCountryCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const code = item.trim().toUpperCase();
    if (CODE_TO_OPTION.has(code)) seen.add(code);
  }
  return Array.from(seen);
}

export function getCountryOption(code: string): CountryOption | null {
  return CODE_TO_OPTION.get(code.trim().toUpperCase()) ?? null;
}

/**
 * Convert an ISO 3166-1 alpha-2 code into its flag emoji.
 *
 * Two regional-indicator code points (one per letter) render as a flag
 * on every modern OS — except Windows, which only renders the letters.
 * That's the trade-off; the alternative is shipping ~40 SVGs to satisfy
 * a small subset of users on a non-default platform. Unicode-only here.
 */
export function countryFlagEmoji(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  const offset = 0x1f1e6 - 0x41;
  return (
    String.fromCodePoint(upper.charCodeAt(0) + offset) +
    String.fromCodePoint(upper.charCodeAt(1) + offset)
  );
}

/**
 * Return the country codes referenced anywhere in `query`. Used by the
 * discover flow to bias the first-round recall toward experts who marked
 * those countries as a focus.
 */
export function detectCountriesInQuery(query: string): string[] {
  if (!query) return [];
  const lower = query.toLowerCase();
  const hits = new Set<string>();
  for (const country of COUNTRY_LIST) {
    for (const term of country.searchTerms) {
      // Word-boundary check for ASCII terms, raw substring for CJK.
      const isAscii = /^[a-z0-9 .-]+$/.test(term);
      if (isAscii) {
        const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
        if (re.test(lower)) {
          hits.add(country.code);
          break;
        }
      } else if (lower.includes(term)) {
        hits.add(country.code);
        break;
      }
    }
  }
  return Array.from(hits);
}

/**
 * Return the country codes when the entire query is just a country/region
 * name or code, allowing light punctuation around it. This lets the match
 * flow treat "Japan" as a fresh country search even if the UI still sends
 * earlier chat history.
 */
export function detectStandaloneCountriesInQuery(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const hits = new Set<string>();
  for (const country of COUNTRY_LIST) {
    for (const term of country.searchTerms) {
      const isAscii = /^[a-z0-9 .-]+$/.test(term);
      if (isAscii) {
        const re = new RegExp(
          `^[\\s"'“”‘’()\\[\\]{}.,!?;:，。！？；：-]*${escapeRegex(term)}[\\s"'“”‘’()\\[\\]{}.,!?;:，。！？；：-]*$`,
          "i",
        );
        if (re.test(normalized)) {
          hits.add(country.code);
          break;
        }
      } else if (normalized === term) {
        hits.add(country.code);
        break;
      }
    }
  }
  return Array.from(hits);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the searchable text we mix into expert-keyword indexes so the
 * v1/experts list endpoint and the keyword fallback in /api/experts/match
 * match country mentions on the inquiry side.
 */
export function expertCountriesSearchText(codes: string[]): string {
  if (!codes.length) return "";
  const parts: string[] = [];
  for (const code of codes) {
    const opt = CODE_TO_OPTION.get(code);
    if (!opt) continue;
    parts.push(opt.code, opt.name, opt.nameZh, ...opt.searchTerms);
  }
  return parts.join(" ").toLowerCase();
}
