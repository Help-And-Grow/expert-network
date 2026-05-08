/**
 * WeChat-side mirror of the canonical country/region list.
 *
 * Kept in sync with src/lib/expert-countries.ts (web). The two files must
 * stay aligned because the same ISO 3166-1 alpha-2 codes are read/written
 * to Expert.countries on the backend. If the web list changes, this file
 * must be updated too.
 */
export interface CountryOption {
  code: string;
  name: string;
  nameZh: string;
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
  { code: "IN", name: "India", nameZh: "印度", searchTerms: ["india", "印度", "in"] },
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

const CODE_TO_OPTION: Record<string, CountryOption> = COUNTRY_LIST.reduce(
  (acc, c) => {
    acc[c.code] = c;
    return acc;
  },
  {} as Record<string, CountryOption>,
);

export function listCountries(): CountryOption[] {
  return COUNTRY_LIST;
}

export function getCountryOption(code: string): CountryOption | null {
  return CODE_TO_OPTION[code.trim().toUpperCase()] ?? null;
}

export function searchCountries(query: string): CountryOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRY_LIST;
  return COUNTRY_LIST.filter((c) =>
    [c.code, c.name, c.nameZh, ...c.searchTerms].some((term) =>
      term.toLowerCase().includes(q),
    ),
  );
}

/** WeChat (some Android) renders flag emoji inconsistently — fall back to code if needed. */
export function countryFlagEmoji(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  const offset = 0x1f1e6 - 0x41;
  return (
    String.fromCodePoint(upper.charCodeAt(0) + offset) +
    String.fromCodePoint(upper.charCodeAt(1) + offset)
  );
}
