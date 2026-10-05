import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CONTACT_SEARCH_DEFAULTS = Object.freeze({
  contact_search_enabled: true,
  contact_search_score_threshold: 90,
  contact_search_max_rounds: 3,
  contact_search_top_k: 5,
});

const phonePattern = /^\+?[0-9][0-9 ()-]{5,30}[0-9]$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function loadCrmProvinceCityMap() {
  const sourcePath = fileURLToPath(new URL("../src/lib/region-data.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const literal = source.match(/PROVINCE_CITY_MAP:\s*Record<string, string\[\]>\s*=\s*(\{[\s\S]*?\n\});/u)?.[1];
  if (!literal) throw new Error("CRM_REGION_DATA_INVALID");
  return JSON.parse(literal.replace(/,\s*([}\]])/gu, "$1"));
}

export const CRM_PROVINCE_CITY_MAP = Object.freeze(loadCrmProvinceCityMap());

export function isValidLeadPhone(value) {
  if (typeof value !== "string") return false;
  const phone = value.trim();
  const digits = phone.replace(/\D/gu, "");
  return digits.length >= 7 && digits.length <= 15 && phonePattern.test(phone);
}

export function isValidLeadEmail(value) {
  return typeof value === "string"
    && value.trim().length <= 191
    && emailPattern.test(value.trim());
}

export function normalizeStructuredRegion(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { province: null, city: null };
  }
  const province = typeof profile.province === "string" ? profile.province.trim() : "";
  const validCities = CRM_PROVINCE_CITY_MAP[province];
  if (!Array.isArray(validCities)) return { province: null, city: null };
  const city = typeof profile.city === "string" ? profile.city.trim() : "";
  if (validCities.length === 0) {
    return city ? { province: null, city: null } : { province, city: null };
  }
  if (city && !validCities.includes(city)) return { province: null, city: null };
  return { province, city: city || null };
}

export function buildInitialContactQuery({ companyName, profile }) {
  const company = typeof companyName === "string" ? companyName.trim() : "";
  if (!company) throw new Error("CONTACT_SEARCH_COMPANY_REQUIRED");
  const region = normalizeStructuredRegion(profile);
  return [company, region.province, region.city, "电话", "邮箱", "联系方式", "官网"]
    .filter(Boolean)
    .join(" ");
}

function candidateEvidence(result, value) {
  return {
    value,
    resultTitle: typeof result.title === "string" ? result.title.trim() : "",
    resultUrl: typeof result.url === "string" ? result.url.trim() : "",
    resultContent: [result.content, result.snippet]
      .filter((part) => typeof part === "string" && part.trim())
      .join("\n")
      .slice(0, 4_000),
  };
}

export function extractContactCandidates(results) {
  if (!Array.isArray(results)) return { candidatePhones: [], candidateEmails: [] };
  const candidatePhones = [];
  const candidateEmails = [];
  const seenPhones = new Set();
  const seenEmails = new Set();
  const phoneCandidatePattern = /\+\d{1,3}(?:[ -]?\d){6,14}|1[3-9](?:[ -]?\d){9}|0\d{2,3}[ -]?\d{7,8}(?:[ -]\d{1,6})?|400[ -]?\d{3}[ -]?\d{4}/gu;
  const emailCandidatePattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/giu;

  for (const result of results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const text = [result.title, result.content, result.snippet]
      .filter((part) => typeof part === "string" && part.trim())
      .join("\n");
    for (const match of text.match(phoneCandidatePattern) ?? []) {
      const value = match.trim();
      const identity = value.replace(/\D/gu, "");
      if (!isValidLeadPhone(value) || seenPhones.has(identity)) continue;
      seenPhones.add(identity);
      candidatePhones.push(candidateEvidence(result, value));
    }
    for (const match of text.match(emailCandidatePattern) ?? []) {
      const value = match.trim();
      const identity = value.toLowerCase();
      if (!isValidLeadEmail(value) || seenEmails.has(identity)) continue;
      seenEmails.add(identity);
      candidateEmails.push(candidateEvidence(result, value));
    }
  }
  return { candidatePhones, candidateEmails };
}

const contactQueryStrategies = new Set([
  "OFFICIAL_CONTACT",
  "PHONE",
  "EMAIL",
  "BUSINESS_DIRECTORY",
  "REGION_DISAMBIGUATION",
]);

function queryIdentity(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function parseQueryPlannerOutput(rawOutput, previousQueries = []) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawOutput));
  } catch {
    throw new Error("CONTACT_QUERY_PLANNER_INVALID_OUTPUT");
  }
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.keys(parsed).sort()
    : [];
  const query = typeof parsed?.query === "string" ? parsed.query.trim() : "";
  if (
    keys.join("|") !== "query|strategy"
    || !query
    || query.length > 191
    || !contactQueryStrategies.has(parsed.strategy)
  ) {
    throw new Error("CONTACT_QUERY_PLANNER_INVALID_OUTPUT");
  }
  const used = new Set(previousQueries
    .filter((value) => typeof value === "string")
    .map(queryIdentity));
  if (used.has(queryIdentity(query))) throw new Error("CONTACT_QUERY_REPEATED");
  return { query, strategy: parsed.strategy };
}

function candidateIdentity(kind, value) {
  return kind === "phone" ? value.replace(/\D/gu, "") : value.trim().toLowerCase();
}

function candidateIsPlatformSupport(candidate) {
  let hostname = "";
  try {
    hostname = new URL(candidate.resultUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
  const platformHost = /(^|\.)(?:baidu\.com|1688\.com|alibaba\.com|made-in-china\.com)$/u.test(hostname);
  const supportLanguage = /(?:平台|网站|百度|1688|阿里).{0,8}(?:客服|热线)|(?:客服|热线).{0,8}(?:平台|网站|百度|1688|阿里)/u
    .test(`${candidate.resultTitle}\n${candidate.resultContent}`);
  return platformHost && supportLanguage;
}

function candidateIsNewsAuthor(candidate) {
  const context = `${candidate?.resultTitle ?? ""}\n${candidate?.resultContent ?? ""}`;
  return /(?:记者|作者|编辑|通讯员|投稿).{0,16}(?:电话|手机|邮箱)|(?:电话|手机|邮箱).{0,16}(?:记者|作者|编辑|通讯员|投稿)/u.test(context);
}

export function parseContactVerifierOutput(rawOutput, candidates) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawOutput));
  } catch {
    throw new Error("CONTACT_VERIFIER_INVALID_OUTPUT");
  }
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.keys(parsed).sort()
    : [];
  const exactKeys = "city|companyMatched|email|evidence|phone|province|verified";
  const nullableString = (value) => value === null || (typeof value === "string" && value.trim());
  if (
    keys.join("|") !== exactKeys
    || typeof parsed.verified !== "boolean"
    || typeof parsed.companyMatched !== "boolean"
    || !nullableString(parsed.phone)
    || !nullableString(parsed.email)
    || !nullableString(parsed.province)
    || !nullableString(parsed.city)
    || typeof parsed.evidence !== "string"
    || !parsed.evidence.trim()
    || parsed.evidence.trim().length > 1_000
  ) {
    throw new Error("CONTACT_VERIFIER_INVALID_OUTPUT");
  }
  if (!parsed.verified) {
    if (parsed.companyMatched || parsed.phone || parsed.email || parsed.province || parsed.city) {
      throw new Error("CONTACT_VERIFIER_INVALID_OUTPUT");
    }
    return { ...parsed, evidence: parsed.evidence.trim() };
  }
  if (!parsed.companyMatched || (!parsed.phone && !parsed.email)) {
    throw new Error("CONTACT_NOT_VERIFIED");
  }

  const phoneIdentity = parsed.phone ? candidateIdentity("phone", parsed.phone) : null;
  const emailIdentity = parsed.email ? candidateIdentity("email", parsed.email) : null;
  const phoneCandidate = phoneIdentity
    ? candidates?.candidatePhones?.find((candidate) => candidateIdentity("phone", candidate.value) === phoneIdentity)
    : null;
  const emailCandidate = emailIdentity
    ? candidates?.candidateEmails?.find((candidate) => candidateIdentity("email", candidate.value) === emailIdentity)
    : null;
  if (
    (parsed.phone && (!phoneCandidate || candidateIsPlatformSupport(phoneCandidate)))
    || (parsed.email && (!emailCandidate || candidateIsPlatformSupport(emailCandidate)))
  ) {
    throw new Error("CONTACT_NOT_VERIFIED");
  }

  if (parsed.province || parsed.city) {
    const normalized = normalizeStructuredRegion({ province: parsed.province, city: parsed.city });
    if (normalized.province !== parsed.province || normalized.city !== parsed.city) {
      throw new Error("CONTACT_NOT_VERIFIED");
    }
  }
  return {
    verified: true,
    companyMatched: true,
    phone: parsed.phone?.trim() ?? null,
    email: parsed.email?.trim() ?? null,
    province: parsed.province?.trim() ?? null,
    city: parsed.city?.trim() ?? null,
    evidence: parsed.evidence.trim(),
  };
}

const verifierV11Keys = [
  "city",
  "classification",
  "contactEvidence",
  "email",
  "evidenceUrl",
  "matchedCompanyName",
  "opportunityEvidence",
  "opportunityType",
  "phone",
  "province",
  "relationshipType",
];

function companyIdentity(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

function directContactEvidenceBacked(evidenceText, targetCompanyName, contacts) {
  const targetIdentity = companyIdentity(targetCompanyName);
  const normalizedContacts = contacts
    .filter((contact) => contact?.value)
    .map((contact) => ({ type: contact.type, value: companyIdentity(contact.value) }));
  if (!targetIdentity || normalizedContacts.length === 0) return false;
  const permutations = (values) => values.length <= 1
    ? [values]
    : values.flatMap((value, index) => permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
      .map((rest) => [value, ...rest]));
  const labelledContact = (contact) => contact.type === "phone"
    ? `(?:联系方式|联系电话|联系手机|电话|手机)(?:为|是)?${contact.value}`
    : `(?:联系方式|联系邮箱|邮箱|电子邮箱|email)(?:为|是)?${contact.value}`;
  const templates = permutations(normalizedContacts).map((orderedContacts) => (
    `^${targetIdentity}(?:官网|官方网站)?${orderedContacts.map(labelledContact).join("")}$`
  ));
  const clauses = String(evidenceText)
    .split(/[\n。！？；;]+/u)
    .map(companyIdentity)
    .filter(Boolean);
  return clauses.some((clause) => templates.some((template) => new RegExp(template, "u").test(clause)));
}

const relatedRelationshipTypes = new Set(["DEALER", "AGENT", "UPSTREAM", "DOWNSTREAM", "RELATED_COMPANY"]);
const relationshipEvidencePatterns = {
  DEALER: /(?:经销商|经销|授权经销)/u,
  AGENT: /(?:代理商|代理机构|授权代理|代理销售)/u,
  UPSTREAM: /(?:上游|供应商|供货|配套企业)/u,
  DOWNSTREAM: /(?:下游|客户企业|终端客户|采购方)/u,
  RELATED_COMPANY: /(?:关联企业|子公司|母公司|集团成员|合作伙伴|战略合作|参股|控股)/u,
};

function relationshipEvidenceBacked(evidenceText, targetCompanyName, relatedCompanyName, relationshipType) {
  const targetIdentity = companyIdentity(targetCompanyName);
  const relatedIdentity = companyIdentity(relatedCompanyName);
  if (!targetIdentity || !relatedIdentity || !relationshipEvidencePatterns[relationshipType]) return false;
  const templates = {
    DEALER: [
      `${relatedIdentity}(?:是|为|作为|系)?${targetIdentity}(?:的|授权)?(?:经销商|经销|授权经销)`,
      `${targetIdentity}(?:授权)?${relatedIdentity}(?:为|作为|担任)?(?:经销商|经销|授权经销)`,
      `${targetIdentity}(?:的)?(?:经销商|授权经销商)(?:是|为)?${relatedIdentity}`,
    ],
    AGENT: [
      `${relatedIdentity}(?:是|为|作为|系)?${targetIdentity}(?:的|授权)?(?:代理商|代理机构|授权代理|代理销售)`,
      `${targetIdentity}(?:授权)?${relatedIdentity}(?:为|作为|担任)?(?:代理商|代理机构|授权代理)`,
      `${targetIdentity}(?:的)?(?:代理商|代理机构|授权代理)(?:是|为)?${relatedIdentity}`,
    ],
    UPSTREAM: [
      `${relatedIdentity}(?:是|为|作为|系)?${targetIdentity}(?:的)?(?:上游|供应商|供货商|配套企业)`,
      `${relatedIdentity}(?:向|为)${targetIdentity}(?:供货|供应|配套)`,
      `${targetIdentity}(?:的)?(?:上游|供应商|供货商|配套企业)(?:是|为)?${relatedIdentity}`,
      `${targetIdentity}由${relatedIdentity}(?:供货|供应|配套)`,
    ],
    DOWNSTREAM: [
      `${relatedIdentity}(?:是|为|作为|系)?${targetIdentity}(?:的)?(?:下游|客户企业|终端客户|采购方)`,
      `${targetIdentity}(?:的)?(?:下游|客户企业|终端客户|采购方)(?:是|为)?${relatedIdentity}`,
      `${relatedIdentity}(?:向|从)${targetIdentity}(?:采购|购置)`,
    ],
    RELATED_COMPANY: [
      `${relatedIdentity}(?:是|为|作为|系)?${targetIdentity}(?:的)?(?:关联企业|子公司|母公司|集团成员|合作伙伴)`,
      `${targetIdentity}(?:是|为|作为|系)?${relatedIdentity}(?:的)?(?:关联企业|子公司|母公司|集团成员|合作伙伴)`,
      `${relatedIdentity}(?:与|和)${targetIdentity}(?:建立|达成|开展|形成|是|为)?(?:战略合作|合作伙伴|参股|控股|关联)`,
      `${targetIdentity}(?:与|和)${relatedIdentity}(?:建立|达成|开展|形成|是|为)?(?:战略合作|合作伙伴|参股|控股|关联)`,
    ],
  };
  const clauses = String(evidenceText)
    .split(/[\n。！？；;]+/u)
    .map(companyIdentity)
    .filter(Boolean);
  return (templates[relationshipType] ?? []).some((template) => clauses.some((clause) => (
    new RegExp(`^(?:${template})$`, "u").test(clause)
  )));
}

function opportunityEvidenceBacked(evidenceText, relatedCompanyName, opportunityType, opportunityEvidence) {
  const relatedIdentity = companyIdentity(relatedCompanyName);
  const quoteIdentity = companyIdentity(opportunityEvidence);
  if (!relatedIdentity || !quoteIdentity) return false;
  const templates = {
    MANUFACTURING_CAPABILITY: `^${relatedIdentity}(?:正在|计划|拟|将|已|拥有|具备|从事|开展|建设|设有)(?:数控|齿轮|金属|零部件|模具|精密|机械)*(?:制造|生产|机加工|加工车间|工厂|车间)(?:能力|业务|项目|生产线)?$`,
    MACHINING_DEMAND: `^${relatedIdentity}(?:正在|计划|拟|将|已|拥有|具备|从事|开展)(?:数控|齿轮|金属|零部件|模具|精密|机械)*(?:机加工|加工|切削)(?:需求|能力|业务|项目)?$`,
    EQUIPMENT_PURCHASE: `^${relatedIdentity}(?:正在|计划|拟|将|已|启动|发布)(?:采购|求购|招标|购置|询价)(?:数控|齿轮|金属|加工|生产|自动化|新|相关|一批|多台|台|套|高端|大型|精密|国产|进口|智能|专用)*(?:机床|设备|生产线|加工中心|车床|铣床|磨床|钻床|镗床|刨床|插床|滚齿机)(?:并(?:建设|扩建)(?:数控|齿轮|加工|生产|自动化)*(?:车间|生产线))?$`,
    CAPACITY_EXPANSION: `^${relatedIdentity}(?:正在|计划|拟|将|已|启动)(?:扩产|扩建|提升产能|新建生产线|新建车间)(?:项目|计划)?$`,
    TECHNICAL_UPGRADE: `^${relatedIdentity}(?:正在|计划|拟|将|已|启动)(?:技改|技术改造|设备升级|自动化改造)(?:项目|计划)?$`,
  };
  const template = templates[opportunityType];
  if (!template || !new RegExp(template, "u").test(quoteIdentity)) return false;
  return String(evidenceText)
    .split(/[\n。！？；;]+/u)
    .map(companyIdentity)
    .includes(quoteIdentity);
}
const opportunityEvidencePatterns = {
  MANUFACTURING_CAPABILITY: /(?:制造|生产|机加工|加工车间|工厂|车间)/u,
  MACHINING_DEMAND: /(?:机加工|加工|切削|齿轮|金属|模具|零部件)/u,
  EQUIPMENT_PURCHASE: /(?:采购|求购|招标|购置|询价|设备需求)/u,
  CAPACITY_EXPANSION: /(?:扩产|扩建|产能|新建.{0,8}(?:生产线|车间))/u,
  TECHNICAL_UPGRADE: /(?:技改|技术改造|升级|自动化改造)/u,
};

function rejectedV11Disposition(parsed, rejectionReason) {
  return {
    ...parsed,
    classification: "REJECT",
    phone: null,
    email: null,
    province: null,
    city: null,
    evidenceUrl: null,
    opportunityType: null,
    opportunityEvidence: null,
    contactEvidence: parsed.contactEvidence.trim(),
    rejectionReason,
  };
}

export function parseContactVerifierV11Output(rawOutput, {
  targetCompanyName,
  candidates,
  searchResults,
}) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawOutput));
  } catch {
    throw new Error("CONTACT_VERIFIER_INVALID_OUTPUT");
  }
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.keys(parsed).sort()
    : [];
  const nullableString = (value) => value === null || (typeof value === "string" && value.trim());
  if (
    keys.join("|") !== verifierV11Keys.join("|")
    || !["DIRECT_CONTACT", "RELATED_OPPORTUNITY", "REJECT"].includes(parsed.classification)
    || !nullableString(parsed.matchedCompanyName)
    || !nullableString(parsed.phone)
    || !nullableString(parsed.email)
    || !nullableString(parsed.province)
    || !nullableString(parsed.city)
    || !nullableString(parsed.evidenceUrl)
    || !nullableString(parsed.opportunityEvidence)
    || !nullableString(parsed.opportunityType)
    || typeof parsed.relationshipType !== "string"
    || typeof parsed.contactEvidence !== "string"
    || !parsed.contactEvidence.trim()
  ) {
    throw new Error("CONTACT_VERIFIER_INVALID_OUTPUT");
  }
  if (parsed.classification === "REJECT") {
    if (
      parsed.phone !== null
      || parsed.email !== null
      || parsed.province !== null
      || parsed.city !== null
      || parsed.evidenceUrl !== null
      || parsed.opportunityType !== null
      || parsed.opportunityEvidence !== null
    ) {
      throw new Error("CONTACT_VERIFIER_INVALID_OUTPUT");
    }
    return rejectedV11Disposition(parsed, "VERIFIER_REJECT");
  }
  const phoneIdentity = parsed.phone ? candidateIdentity("phone", parsed.phone) : null;
  const emailIdentity = parsed.email ? candidateIdentity("email", parsed.email) : null;
  const phoneCandidate = phoneIdentity
    ? candidates?.candidatePhones?.find((candidate) => candidateIdentity("phone", candidate.value) === phoneIdentity)
    : null;
  const emailCandidate = emailIdentity
    ? candidates?.candidateEmails?.find((candidate) => candidateIdentity("email", candidate.value) === emailIdentity)
    : null;
  const evidenceUrl = parsed.evidenceUrl?.trim() ?? "";
  const evidenceResult = Array.isArray(searchResults)
    ? searchResults.find((result) => result?.url === evidenceUrl)
    : null;
  const selectedCandidates = [phoneCandidate, emailCandidate].filter(Boolean);
  const unsafeContact = selectedCandidates.some((candidate) => (
    candidateIsPlatformSupport(candidate) || candidateIsNewsAuthor(candidate)
  ));
  if (unsafeContact) return rejectedV11Disposition(parsed, "UNSAFE_CONTACT_SOURCE");
  const contactBacked = selectedCandidates.length > 0
    && selectedCandidates.every((candidate) => candidate.resultUrl === evidenceUrl);
  const region = normalizeStructuredRegion({ province: parsed.province, city: parsed.city });
  const regionBacked = (!parsed.province && !parsed.city)
    || (region.province === parsed.province && region.city === parsed.city);
  if (!contactBacked || !evidenceResult || !regionBacked) {
    throw new Error("CONTACT_NOT_VERIFIED");
  }
  const evidenceBody = String(evidenceResult.snippet ?? evidenceResult.content ?? "");
  const evidenceHasQuestion = /[?？]/u.test(evidenceBody);
  const evidenceClauseCount = evidenceBody.split(/[\n。！？；;]+/u).map(companyIdentity).filter(Boolean).length;
  const evidenceText = `${evidenceResult.title ?? ""}\n${evidenceBody}`;
  if (parsed.classification === "DIRECT_CONTACT") {
    if (
      parsed.relationshipType !== "TARGET"
      || parsed.opportunityType !== null
      || parsed.opportunityEvidence !== null
      || companyIdentity(parsed.matchedCompanyName) !== companyIdentity(targetCompanyName)
      || evidenceHasQuestion
      || evidenceClauseCount !== 1
      || !directContactEvidenceBacked(evidenceBody, targetCompanyName, [
        { type: "phone", value: parsed.phone },
        { type: "email", value: parsed.email },
      ])
    ) {
      throw new Error("CONTACT_NOT_VERIFIED");
    }
  } else {
    const pattern = opportunityEvidencePatterns[parsed.opportunityType];
    const relationshipPattern = relationshipEvidencePatterns[parsed.relationshipType];
    const opportunityEvidence = parsed.opportunityEvidence?.trim() ?? "";
    if (
      !relatedRelationshipTypes.has(parsed.relationshipType)
      || typeof parsed.matchedCompanyName !== "string"
      || !parsed.matchedCompanyName.trim()
      || !relationshipPattern
      || !pattern
      || !opportunityEvidence
      || companyIdentity(parsed.matchedCompanyName) === companyIdentity(targetCompanyName)
      || evidenceHasQuestion
      || evidenceClauseCount !== 3
      || !companyIdentity(evidenceText).includes(companyIdentity(parsed.matchedCompanyName))
      || !companyIdentity(evidenceText).includes(companyIdentity(targetCompanyName))
      || !directContactEvidenceBacked(evidenceBody, parsed.matchedCompanyName, [
        { type: "phone", value: parsed.phone },
        { type: "email", value: parsed.email },
      ])
      || !relationshipEvidenceBacked(evidenceBody, targetCompanyName, parsed.matchedCompanyName, parsed.relationshipType)
      || !opportunityEvidenceBacked(evidenceBody, parsed.matchedCompanyName, parsed.opportunityType, opportunityEvidence)
      || !pattern.test(opportunityEvidence)
    ) {
      return rejectedV11Disposition(parsed, "RELATED_OPPORTUNITY_NOT_SUPPORTED");
    }
  }
  return {
    ...parsed,
    matchedCompanyName: parsed.matchedCompanyName.trim(),
    phone: parsed.phone?.trim() ?? null,
    email: parsed.email?.trim() ?? null,
    province: parsed.province?.trim() ?? null,
    city: parsed.city?.trim() ?? null,
    evidenceUrl,
    contactEvidence: parsed.contactEvidence.trim(),
    opportunityEvidence: parsed.opportunityEvidence?.trim() ?? null,
  };
}

export function buildScoredRelatedLead({
  targetLead,
  disposition,
  scoredLead,
  contactSearchQuery,
}) {
  if (
    disposition?.classification !== "RELATED_OPPORTUNITY"
    || typeof disposition.matchedCompanyName !== "string"
    || !disposition.matchedCompanyName.trim()
    || !Number.isInteger(scoredLead?.aiScore)
    || scoredLead.aiScore < 0
    || scoredLead.aiScore > 100
    || !scoredLead.profile
    || typeof scoredLead.profile !== "object"
    || Array.isArray(scoredLead.profile)
  ) {
    throw new Error("RELATED_OPPORTUNITY_SCORE_INVALID");
  }
  const region = normalizeStructuredRegion({ province: disposition.province, city: disposition.city });
  const validatedLead = {
    companyName: disposition.matchedCompanyName.trim(),
    ...(typeof scoredLead.contactName === "string" && scoredLead.contactName.trim()
      ? { contactName: scoredLead.contactName.trim() }
      : {}),
    ...(disposition.phone ? { phone: disposition.phone.trim() } : {}),
    ...(disposition.email ? { email: disposition.email.trim() } : {}),
    aiScore: scoredLead.aiScore,
    sourceUrl: disposition.evidenceUrl,
    searchKeyword: typeof contactSearchQuery === "string" ? contactSearchQuery.trim() : undefined,
    profile: {
      ...scoredLead.profile,
      leadOrigin: "RELATED_OPPORTUNITY",
      relatedToCompanyName: targetLead?.companyName ?? null,
      relationshipType: disposition.relationshipType,
      opportunityType: disposition.opportunityType,
      opportunityEvidence: disposition.opportunityEvidence,
      contactEvidence: disposition.contactEvidence,
      ...(region.province ? { province: region.province } : {}),
      ...(region.city ? { city: region.city } : {}),
    },
  };
  const entry = decideContactEnrichment(validatedLead);
  return {
    validatedLead,
    shouldWrite: entry.shouldWrite,
    contactSearchAllowed: false,
    status: entry.shouldWrite ? "RELATED_OPPORTUNITY_READY" : "RELATED_OPPORTUNITY_BELOW_ENTRY_GATE",
  };
}

function backfillVerifiedContact(validatedLead, verified) {
  const currentProfile = validatedLead.profile && typeof validatedLead.profile === "object" && !Array.isArray(validatedLead.profile)
    ? validatedLead.profile
    : {};
  const profile = {
    ...currentProfile,
    ...(verified.province ? { province: verified.province } : {}),
    ...(verified.city ? { city: verified.city } : {}),
  };
  return {
    ...validatedLead,
    ...(verified.phone ? { phone: verified.phone } : {}),
    ...(verified.email ? { email: verified.email } : {}),
    profile,
  };
}

function summarizedResults(results, topK) {
  if (!Array.isArray(results)) return [];
  return results.slice(0, topK).map((result) => {
    const url = typeof result?.url === "string" ? result.url : "";
    if (!url || url.length > 2_048 || url !== url.trim()) {
      throw new Error("INVALID_ARGUMENT sourceUrl must be an unchanged HTTP(S) URL with at most 2048 characters");
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("INVALID_ARGUMENT sourceUrl must be a valid HTTP(S) URL");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("INVALID_ARGUMENT sourceUrl only allows HTTP(S) URLs");
    }
    const domain = parsedUrl.hostname.toLowerCase();
    return {
      title: typeof result?.title === "string" ? result.title.slice(0, 300) : "",
      url,
      domain,
      snippet: [result?.content, result?.snippet]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n")
      .slice(0, 2_000),
    };
  });
}

function safeFailureCode(error, fallback) {
  const code = error instanceof Error ? error.message : "";
  return [
    "CONTACT_QUERY_PLANNER_INVALID_OUTPUT",
    "CONTACT_QUERY_REPEATED",
    "CONTACT_VERIFIER_INVALID_OUTPUT",
    "CONTACT_NOT_VERIFIED",
  ].includes(code) ? code : fallback;
}

function sanitizedLeadContacts(lead) {
  const sanitized = { ...lead };
  if (isValidLeadPhone(sanitized.phone)) sanitized.phone = sanitized.phone.trim();
  else delete sanitized.phone;
  if (isValidLeadEmail(sanitized.email)) sanitized.email = sanitized.email.trim();
  else delete sanitized.email;
  if (typeof sanitized.contactName === "string" && sanitized.contactName.trim()) {
    sanitized.contactName = sanitized.contactName.trim();
  } else {
    delete sanitized.contactName;
  }
  return sanitized;
}

export async function runContactEnrichment({
  validatedLead,
  config: inputConfig = {},
  search,
  planQuery,
  verify,
}) {
  validatedLead = sanitizedLeadContacts(validatedLead);
  const config = parseContactSearchConfig(inputConfig);
  const entry = decideContactEnrichment(validatedLead, config);
  if (!entry.shouldSearch) {
    return {
      validatedLead,
      ...entry,
      contactSearchRound: 0,
      lastFailureStatus: null,
      previousQueries: [],
    };
  }
  if (typeof search !== "function" || typeof planQuery !== "function" || typeof verify !== "function") {
    throw new Error("CONTACT_SEARCH_DEPENDENCY_INVALID");
  }

  let contactSearchRound = 0;
  let lastFailureStatus = null;
  const previousQueries = [];
  const excludedResults = [];

  while (true) {
    const budget = prepareContactSearchRound({ contactSearchRound, config });
    if (!budget.shouldSearch) {
      return {
        validatedLead,
        shouldWrite: false,
        shouldSearch: false,
        contactSearchRound,
        status: budget.status,
        lastFailureStatus,
        previousQueries,
      };
    }
    contactSearchRound = budget.contactSearchRound;

    let queryPlan;
    if (contactSearchRound === 1) {
      queryPlan = {
        query: buildInitialContactQuery(validatedLead),
        strategy: "OFFICIAL_CONTACT",
      };
    } else {
      try {
        const rawPlan = await planQuery({
          companyName: validatedLead.companyName,
          industry: validatedLead.profile?.industry ?? null,
          businessScope: validatedLead.profile?.businessScope ?? null,
          ...normalizeStructuredRegion(validatedLead.profile),
          sourceUrl: validatedLead.sourceUrl ?? null,
          searchKeyword: validatedLead.searchKeyword ?? null,
          previousQueries: [...previousQueries],
          excludedResults: [...excludedResults],
          contactSearchRound,
        });
        queryPlan = parseQueryPlannerOutput(rawPlan, previousQueries);
      } catch (error) {
        return {
          validatedLead,
          shouldWrite: false,
          shouldSearch: false,
          contactSearchRound,
          status: safeFailureCode(error, "CONTACT_QUERY_PLANNER_INVALID_OUTPUT"),
          lastFailureStatus: safeFailureCode(error, "CONTACT_QUERY_PLANNER_INVALID_OUTPUT"),
          previousQueries,
        };
      }
    }
    previousQueries.push(queryPlan.query);

    let results;
    let searchFailed = false;
    try {
      results = await search({
        query: queryPlan.query,
        strategy: queryPlan.strategy,
        topK: config.contact_search_top_k,
        contactSearchRound,
      });
    } catch {
      results = [];
      searchFailed = true;
    }
    const summaries = summarizedResults(results, config.contact_search_top_k);
    excludedResults.push(...summaries);
    const candidates = extractContactCandidates(summaries);
    if (candidates.candidatePhones.length === 0 && candidates.candidateEmails.length === 0) {
      lastFailureStatus = searchFailed ? "CONTACT_SEARCH_API_ERROR" : "CONTACT_NOT_FOUND";
      continue;
    }

    let verified;
    try {
      const rawVerification = await verify({
        targetCompanyName: validatedLead.companyName,
        targetProfile: validatedLead.profile ?? null,
        ...normalizeStructuredRegion(validatedLead.profile),
        candidates,
        searchResults: summaries,
        contactSearchRound,
      });
      verified = parseContactVerifierOutput(rawVerification, candidates);
    } catch (error) {
      lastFailureStatus = safeFailureCode(error, "CONTACT_VERIFIER_INVALID_OUTPUT");
      continue;
    }
    if (!verified.verified) {
      lastFailureStatus = "CONTACT_NOT_VERIFIED";
      continue;
    }

    const enrichedLead = backfillVerifiedContact(validatedLead, verified);
    const finalGate = decideContactEnrichment(enrichedLead, config);
    return {
      validatedLead: enrichedLead,
      shouldWrite: finalGate.shouldWrite,
      shouldSearch: false,
      contactSearchRound,
      status: finalGate.shouldWrite ? "CONTACT_SEARCH_VERIFIED" : "CONTACT_NOT_VERIFIED",
      lastFailureStatus: finalGate.shouldWrite ? null : "CONTACT_NOT_VERIFIED",
      previousQueries,
      verificationEvidence: verified.evidence,
    };
  }
}

export function parseContactSearchConfig(input = {}) {
  const config = { ...CONTACT_SEARCH_DEFAULTS, ...input };
  const valid = typeof config.contact_search_enabled === "boolean"
    && Number.isInteger(config.contact_search_score_threshold)
    && config.contact_search_score_threshold >= 0
    && config.contact_search_score_threshold <= 100
    && Number.isInteger(config.contact_search_max_rounds)
    && config.contact_search_max_rounds >= 1
    && config.contact_search_max_rounds <= CONTACT_SEARCH_DEFAULTS.contact_search_max_rounds
    && Number.isInteger(config.contact_search_top_k)
    && config.contact_search_top_k >= 1
    && config.contact_search_top_k <= CONTACT_SEARCH_DEFAULTS.contact_search_top_k;
  if (!valid) throw new Error("CONTACT_SEARCH_CONFIG_INVALID");
  return config;
}

export function prepareContactSearchRound({ contactSearchRound, config: inputConfig }) {
  const config = parseContactSearchConfig(inputConfig);
  if (!Number.isInteger(contactSearchRound) || contactSearchRound < 0) {
    throw new Error("CONTACT_SEARCH_ROUND_INVALID");
  }
  if (contactSearchRound >= config.contact_search_max_rounds) {
    return {
      contactSearchRound,
      shouldSearch: false,
      status: "CONTACT_ENRICHMENT_EXHAUSTED",
    };
  }
  return {
    contactSearchRound: contactSearchRound + 1,
    shouldSearch: true,
    status: "CONTACT_SEARCH_STARTED",
  };
}

export function decideContactEnrichment(lead, config = CONTACT_SEARCH_DEFAULTS) {
  const aiScore = Number(lead?.aiScore);
  const hasContact = isValidLeadPhone(lead?.phone) || isValidLeadEmail(lead?.email);
  const shouldWrite = Number.isInteger(aiScore) && aiScore >= 80 && hasContact;
  const shouldSearch = Boolean(config.contact_search_enabled)
    && Number.isInteger(aiScore)
    && aiScore > Number(config.contact_search_score_threshold)
    && !hasContact;
  return {
    shouldWrite,
    shouldSearch,
    status: shouldSearch ? "CONTACT_SEARCH_STARTED" : "CONTACT_SEARCH_NOT_REQUIRED",
  };
}
