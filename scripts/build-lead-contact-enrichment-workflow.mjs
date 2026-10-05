import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { CRM_PROVINCE_CITY_MAP } from "./lead-contact-enrichment-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const basePath = `${root}n8n/workflows/baidu-lead-e2e-n4-pass.json`;
const outputPath = `${root}n8n/workflows/baidu-lead-contact-enrichment-v1.json`;
const relatedOutputPath = `${root}n8n/workflows/baidu-lead-contact-enrichment-v1.1.json`;

function contactEntryGate() {
  const config = $('Search Config').first().json;
  const phoneValid = (value) => typeof value === 'string' && /^\+?[0-9][0-9 ()-]{5,30}[0-9]$/.test(value.trim()) && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15;
  const emailValid = (value) => typeof value === 'string' && value.trim().length <= 191 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  return $input.all().map((item, index) => {
    const validatedLead = { ...item.json.validatedLead };
    if (phoneValid(validatedLead.phone)) validatedLead.phone = validatedLead.phone.trim();
    else delete validatedLead.phone;
    if (emailValid(validatedLead.email)) validatedLead.email = validatedLead.email.trim();
    else delete validatedLead.email;
    if (typeof validatedLead.contactName === 'string' && validatedLead.contactName.trim()) validatedLead.contactName = validatedLead.contactName.trim();
    else delete validatedLead.contactName;
    const aiScore = Number(validatedLead?.aiScore);
    const hasContact = phoneValid(validatedLead?.phone) || emailValid(validatedLead?.email);
    const shouldWrite = Number.isInteger(aiScore) && aiScore >= 80 && hasContact;
    const shouldSearch = config.contact_search_enabled === true
      && Number.isInteger(aiScore)
      && aiScore > Number(config.contact_search_score_threshold)
      && !hasContact;
    return { json: {
      ...item.json,
      validatedLead,
      shouldWrite,
      shouldSearch,
      contactSearchRound: 0,
      contactSearchMaxRounds: Math.min(Number(config.contact_search_max_rounds), 3),
      previousQueries: [],
      excludedResults: [],
      status: shouldSearch ? 'CONTACT_SEARCH_STARTED' : 'CONTACT_SEARCH_NOT_REQUIRED',
      lastFailureStatus: null,
    }, pairedItem: { item: index } };
  });
}

function prepareContactRound() {
  const config = $('Search Config').first().json;
  return $input.all().map((item, index) => {
    const state = item.json;
    const contactSearchMaxRounds = Math.min(Number(config.contact_search_max_rounds), 3);
    const contactSearchRound = Number(state.contactSearchRound || 0);
    const budgetAllowed = config.contact_search_enabled === true
      && Number.isInteger(contactSearchMaxRounds)
      && contactSearchMaxRounds >= 1
      && contactSearchRound < contactSearchMaxRounds;
    const nextRound = budgetAllowed ? contactSearchRound + 1 : contactSearchRound;
    const profile = state.validatedLead?.profile && typeof state.validatedLead.profile === 'object' && !Array.isArray(state.validatedLead.profile)
      ? state.validatedLead.profile
      : {};
    const rawProvince = typeof profile.province === 'string' ? profile.province.trim() : '';
    const rawCity = typeof profile.city === 'string' ? profile.city.trim() : '';
    const validCities = PROVINCE_CITY_MAP[rawProvince];
    const regionValid = Array.isArray(validCities)
      && (validCities.length === 0 ? !rawCity : (!rawCity || validCities.includes(rawCity)));
    const standardProvince = regionValid ? rawProvince : null;
    const standardCity = regionValid && rawCity ? rawCity : null;
    let contactSearchQuery = null;
    let contactSearchStrategy = null;
    let previousQueries = Array.isArray(state.previousQueries) ? [...state.previousQueries] : [];
    if (budgetAllowed && ROUND === 1) {
      contactSearchQuery = [state.validatedLead.companyName, standardProvince, standardCity, '电话', '邮箱', '联系方式', '官网'].filter(Boolean).join(' ');
      contactSearchStrategy = 'OFFICIAL_CONTACT';
      previousQueries.push(contactSearchQuery);
    }
    return { json: {
      ...state,
      contactSearchRound: nextRound,
      contactSearchMaxRounds,
      contactSearchQuery,
      contactSearchStrategy,
      previousQueries,
      budgetAllowed,
      status: budgetAllowed ? 'CONTACT_SEARCH_STARTED' : 'CONTACT_ENRICHMENT_EXHAUSTED',
    }, pairedItem: { item: index } };
  });
}

function parseQueryPlanner() {
  const strategies = new Set(['OFFICIAL_CONTACT', 'PHONE', 'EMAIL', 'BUSINESS_DIRECTORY', 'REGION_DISAMBIGUATION']);
  const identity = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const prepared = $('Prepare Contact Round ' + ROUND).item.json;
  const content = $json?.choices?.[0]?.message?.content;
  let parsed = null;
  try { parsed = JSON.parse(String(content)); } catch {}
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort().join('|') : '';
  const query = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
  const used = new Set((prepared.previousQueries || []).filter((value) => typeof value === 'string').map(identity));
  const plannerValid = keys === 'query|strategy'
    && query.length > 0
    && query.length <= 191
    && strategies.has(parsed.strategy)
    && !used.has(identity(query));
  return { json: {
    ...prepared,
    plannerValid,
    budgetAllowed: plannerValid,
    contactSearchQuery: plannerValid ? query : null,
    contactSearchStrategy: plannerValid ? parsed.strategy : null,
    previousQueries: plannerValid ? [...prepared.previousQueries, query] : prepared.previousQueries,
    status: plannerValid ? 'CONTACT_SEARCH_STARTED' : 'CONTACT_QUERY_PLANNER_INVALID_OUTPUT',
    lastFailureStatus: plannerValid ? prepared.lastFailureStatus : 'CONTACT_QUERY_PLANNER_INVALID_OUTPUT',
  } };
}

function extractContactCandidates() {
  const sourceName = ROUND === 1 ? 'Prepare Contact Round 1' : 'Parse Query Planner R' + ROUND;
  const state = $(sourceName).item.json;
  const raw = $json;
  const rawResults = Array.isArray(raw?.references) ? raw.references
    : Array.isArray(raw?.data) ? raw.data
    : Array.isArray(raw?.results) ? raw.results
      : Array.isArray(raw?.data?.results) ? raw.data.results
        : [];
  const topK = Math.min(Number($('Search Config').first().json.contact_search_top_k), 5);
  const searchResults = rawResults.slice(0, topK).map((result) => {
    const url = String(result?.url || result?.link || '');
    if (!url || url.length > 2048 || url !== url.trim()) {
      throw new Error('INVALID_ARGUMENT sourceUrl must be an unchanged HTTP(S) URL with at most 2048 characters');
    }
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch {
      throw new Error('INVALID_ARGUMENT sourceUrl must be a valid HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('INVALID_ARGUMENT sourceUrl only allows HTTP(S) URLs');
    }
    const domain = parsedUrl.hostname.toLowerCase();
    return {
      title: String(result?.title || '').slice(0, 300),
      url,
      domain,
      snippet: String(result?.content || result?.snippet || result?.abstract || '').slice(0, 2000),
    };
  });
  const phonePattern = /\+\d{1,3}(?:[ -]?\d){6,14}|1[3-9](?:[ -]?\d){9}|0\d{2,3}[ -]?\d{7,8}(?:[ -]\d{1,6})?|400[ -]?\d{3}[ -]?\d{4}/g;
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi;
  const candidatePhones = [];
  const candidateEmails = [];
  const seenPhones = new Set();
  const seenEmails = new Set();
  for (const result of searchResults) {
    const text = [result.title, result.snippet].join('\n');
    for (const match of text.match(phonePattern) || []) {
      const identity = match.replace(/\D/g, '');
      if (identity.length < 7 || identity.length > 15 || seenPhones.has(identity)) continue;
      seenPhones.add(identity);
      candidatePhones.push({ value: match.trim(), resultTitle: result.title, resultUrl: result.url, resultContent: result.snippet });
    }
    for (const match of text.match(emailPattern) || []) {
      const identity = match.toLowerCase();
      if (seenEmails.has(identity)) continue;
      seenEmails.add(identity);
      candidateEmails.push({ value: match, resultTitle: result.title, resultUrl: result.url, resultContent: result.snippet });
    }
  }
  const hasCandidates = candidatePhones.length > 0 || candidateEmails.length > 0;
  const searchApiError = Boolean(raw?.error) || Number(raw?.statusCode || 200) >= 400;
  return { json: {
    ...state,
    searchResults,
    candidatePhones,
    candidateEmails,
    hasCandidates,
    excludedResults: [...(state.excludedResults || []), ...searchResults],
    status: hasCandidates ? 'CONTACT_SEARCH_STARTED' : (searchApiError ? 'CONTACT_SEARCH_API_ERROR' : 'CONTACT_NOT_FOUND'),
    lastFailureStatus: hasCandidates ? state.lastFailureStatus : (searchApiError ? 'CONTACT_SEARCH_API_ERROR' : 'CONTACT_NOT_FOUND'),
  } };
}

function applyContactVerification() {
  const state = $('Extract Contact Candidates R' + ROUND).item.json;
  const content = $json?.choices?.[0]?.message?.content;
  let parsed = null;
  try { parsed = JSON.parse(String(content)); } catch {}
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort().join('|') : '';
  const nullableString = (value) => value === null || (typeof value === 'string' && value.trim());
  const strict = keys === 'city|companyMatched|email|evidence|phone|province|verified'
    && typeof parsed?.verified === 'boolean'
    && typeof parsed?.companyMatched === 'boolean'
    && nullableString(parsed?.phone)
    && nullableString(parsed?.email)
    && nullableString(parsed?.province)
    && nullableString(parsed?.city)
    && typeof parsed?.evidence === 'string'
    && parsed.evidence.trim().length > 0
    && parsed.evidence.trim().length <= 1000;
  if (!strict) return { json: { ...state, verified: false, status: 'CONTACT_VERIFIER_INVALID_OUTPUT', lastFailureStatus: 'CONTACT_VERIFIER_INVALID_OUTPUT' } };
  if (!parsed.verified || !parsed.companyMatched) return { json: { ...state, verified: false, status: 'CONTACT_NOT_VERIFIED', lastFailureStatus: 'CONTACT_NOT_VERIFIED' } };
  const phoneIdentity = parsed.phone ? parsed.phone.replace(/\D/g, '') : null;
  const emailIdentity = parsed.email ? parsed.email.trim().toLowerCase() : null;
  const phoneCandidate = phoneIdentity ? state.candidatePhones.find((candidate) => candidate.value.replace(/\D/g, '') === phoneIdentity) : null;
  const emailCandidate = emailIdentity ? state.candidateEmails.find((candidate) => candidate.value.toLowerCase() === emailIdentity) : null;
  const platformSupport = (candidate) => {
    if (!candidate) return false;
    let hostname = '';
    try { hostname = new URL(candidate.resultUrl).hostname.toLowerCase(); } catch { return true; }
    const platform = /(^|\.)(?:baidu\.com|1688\.com|alibaba\.com|made-in-china\.com)$/.test(hostname);
    const support = /(?:平台|网站|百度|1688|阿里).{0,8}(?:客服|热线)|(?:客服|热线).{0,8}(?:平台|网站|百度|1688|阿里)/.test(candidate.resultTitle + '\n' + candidate.resultContent);
    return platform && support;
  };
  const verifiedProvince = typeof parsed.province === 'string' ? parsed.province.trim() : '';
  const verifiedCity = typeof parsed.city === 'string' ? parsed.city.trim() : '';
  const validCities = PROVINCE_CITY_MAP[verifiedProvince];
  const regionValid = (!verifiedProvince && !verifiedCity)
    || (Array.isArray(validCities)
      && (validCities.length === 0 ? !verifiedCity : (!verifiedCity || validCities.includes(verifiedCity))));
  const contactValid = Boolean(phoneCandidate || emailCandidate)
    && (!parsed.phone || (phoneCandidate && !platformSupport(phoneCandidate)))
    && (!parsed.email || (emailCandidate && !platformSupport(emailCandidate)));
  if (!contactValid || !regionValid) return { json: { ...state, verified: false, status: 'CONTACT_NOT_VERIFIED', lastFailureStatus: 'CONTACT_NOT_VERIFIED' } };
  const profile = state.validatedLead.profile && typeof state.validatedLead.profile === 'object' && !Array.isArray(state.validatedLead.profile)
    ? state.validatedLead.profile
    : {};
  const validatedLead = {
    ...state.validatedLead,
    ...(parsed.phone ? { phone: parsed.phone.trim() } : {}),
    ...(parsed.email ? { email: parsed.email.trim() } : {}),
    profile: {
      ...profile,
      ...(parsed.province ? { province: parsed.province.trim() } : {}),
      ...(parsed.city ? { city: parsed.city.trim() } : {}),
    },
  };
  return { json: { ...state, validatedLead, verified: true, status: 'CONTACT_SEARCH_VERIFIED', lastFailureStatus: null, verificationEvidence: parsed.evidence.trim() } };
}

function applyContactDispositionV11() {
  const state = $('Extract Contact Candidates R' + ROUND).item.json;
  const reject = (reason) => ({ json: {
    ...state,
    verified: false,
    directContact: false,
    relatedOpportunity: false,
    classification: 'REJECT',
    status: 'CONTACT_REJECTED',
    lastFailureStatus: reason,
  } });
  const content = $json?.choices?.[0]?.message?.content;
  let parsed = null;
  try { parsed = JSON.parse(String(content)); } catch {}
  const expectedKeys = ['city', 'classification', 'contactEvidence', 'email', 'evidenceUrl', 'matchedCompanyName', 'opportunityEvidence', 'opportunityType', 'phone', 'province', 'relationshipType'];
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
  const nullableString = (value) => value === null || (typeof value === 'string' && value.trim());
  const strict = keys.join('|') === expectedKeys.join('|')
    && ['DIRECT_CONTACT', 'RELATED_OPPORTUNITY', 'REJECT'].includes(parsed?.classification)
    && nullableString(parsed?.matchedCompanyName)
    && nullableString(parsed?.phone)
    && nullableString(parsed?.email)
    && nullableString(parsed?.province)
    && nullableString(parsed?.city)
    && nullableString(parsed?.evidenceUrl)
    && nullableString(parsed?.opportunityEvidence)
    && nullableString(parsed?.opportunityType)
    && typeof parsed?.relationshipType === 'string'
    && typeof parsed?.contactEvidence === 'string'
    && parsed.contactEvidence.trim().length > 0
    && parsed.contactEvidence.trim().length <= 1000;
  if (!strict) return reject('CONTACT_VERIFIER_INVALID_OUTPUT');
  if (parsed.classification === 'REJECT') return reject('VERIFIER_REJECT');

  const identity = (value) => String(value || '').normalize('NFKC').trim().replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
  const directContactEvidenceBacked = (targetCompanyName, contacts) => {
    const targetIdentity = identity(targetCompanyName);
    const normalizedContacts = contacts
      .filter((contact) => contact?.value)
      .map((contact) => ({ type: contact.type, value: identity(contact.value) }));
    if (!targetIdentity || normalizedContacts.length === 0) return false;
    const permutations = (values) => values.length <= 1
      ? [values]
      : values.flatMap((value, index) => permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
        .map((rest) => [value, ...rest]));
    const labelledContact = (contact) => contact.type === 'phone'
      ? `(?:联系方式|联系电话|联系手机|电话|手机)(?:为|是)?${contact.value}`
      : `(?:联系方式|联系邮箱|邮箱|电子邮箱|email)(?:为|是)?${contact.value}`;
    const templates = permutations(normalizedContacts).map((orderedContacts) => (
      `^${targetIdentity}(?:官网|官方网站)?${orderedContacts.map(labelledContact).join('')}$`
    ));
    const clauses = evidenceText
      .split(/[\n。！？；;]+/)
      .map(identity)
      .filter(Boolean);
    return clauses.some((clause) => templates.some((template) => new RegExp(template).test(clause)));
  };
  const phoneIdentity = parsed.phone ? parsed.phone.replace(/\D/g, '') : null;
  const emailIdentity = parsed.email ? parsed.email.trim().toLowerCase() : null;
  const phoneCandidate = phoneIdentity ? state.candidatePhones.find((candidate) => candidate.value.replace(/\D/g, '') === phoneIdentity) : null;
  const emailCandidate = emailIdentity ? state.candidateEmails.find((candidate) => candidate.value.toLowerCase() === emailIdentity) : null;
  const evidenceUrl = typeof parsed.evidenceUrl === 'string' ? parsed.evidenceUrl.trim() : '';
  const evidenceResult = state.searchResults.find((result) => result.url === evidenceUrl);
  const platformSupport = (candidate) => {
    if (!candidate) return false;
    let hostname = '';
    try { hostname = new URL(candidate.resultUrl).hostname.toLowerCase(); } catch { return true; }
    const platform = /(^|\.)(?:baidu\.com|1688\.com|alibaba\.com|made-in-china\.com)$/.test(hostname);
    const support = /(?:平台|网站|百度|1688|阿里).{0,8}(?:客服|热线)|(?:客服|热线).{0,8}(?:平台|网站|百度|1688|阿里)/.test(candidate.resultTitle + '\n' + candidate.resultContent);
    return platform && support;
  };
  const selectedCandidates = [phoneCandidate, emailCandidate].filter(Boolean);
  const newsAuthor = (candidate) => /(?:记者|作者|编辑|通讯员|投稿).{0,16}(?:电话|手机|邮箱)|(?:电话|手机|邮箱).{0,16}(?:记者|作者|编辑|通讯员|投稿)/
    .test((candidate?.resultTitle || '') + '\n' + (candidate?.resultContent || ''));
  const unsafeContact = selectedCandidates.some((candidate) => platformSupport(candidate) || newsAuthor(candidate));
  if (unsafeContact) return reject('UNSAFE_CONTACT_SOURCE');
  const contactBacked = selectedCandidates.length > 0
    && selectedCandidates.every((candidate) => candidate.resultUrl === evidenceUrl);
  const province = typeof parsed.province === 'string' ? parsed.province.trim() : '';
  const city = typeof parsed.city === 'string' ? parsed.city.trim() : '';
  const validCities = PROVINCE_CITY_MAP[province];
  const regionValid = (!province && !city)
    || (Array.isArray(validCities) && (validCities.length === 0 ? !city : (!city || validCities.includes(city))));
  if (!contactBacked || !evidenceResult || !regionValid) return reject('CONTACT_NOT_VERIFIED');
  const evidenceText = String(evidenceResult.snippet || '');
  const evidenceHasQuestion = /[?？]/.test(evidenceText);
  const evidenceClauseCount = evidenceText.split(/[\n。！？；;]+/).map(identity).filter(Boolean).length;

  if (parsed.classification === 'DIRECT_CONTACT') {
    if (
      parsed.relationshipType !== 'TARGET'
      || parsed.opportunityType !== null
      || parsed.opportunityEvidence !== null
      || identity(parsed.matchedCompanyName) !== identity(state.validatedLead.companyName)
      || evidenceHasQuestion
      || evidenceClauseCount !== 1
      || !directContactEvidenceBacked(state.validatedLead.companyName, [
        { type: 'phone', value: parsed.phone },
        { type: 'email', value: parsed.email },
      ])
    ) return reject('CONTACT_NOT_VERIFIED');
    const profile = state.validatedLead.profile && typeof state.validatedLead.profile === 'object' && !Array.isArray(state.validatedLead.profile)
      ? state.validatedLead.profile
      : {};
    const validatedLead = {
      ...state.validatedLead,
      ...(parsed.phone ? { phone: parsed.phone.trim() } : {}),
      ...(parsed.email ? { email: parsed.email.trim() } : {}),
      profile: { ...profile, ...(province ? { province } : {}), ...(city ? { city } : {}) },
    };
    return { json: {
      ...state,
      validatedLead,
      verified: true,
      directContact: true,
      relatedOpportunity: false,
      classification: 'DIRECT_CONTACT',
      status: 'CONTACT_SEARCH_VERIFIED',
      lastFailureStatus: null,
      verificationEvidence: parsed.contactEvidence.trim(),
    } };
  }

  if (Array.isArray(state.derivedEvidenceUrls) && state.derivedEvidenceUrls.includes(evidenceUrl)) {
    return reject('RELATED_OPPORTUNITY_ALREADY_PROCESSED');
  }

  const relationshipTypes = new Set(['DEALER', 'AGENT', 'UPSTREAM', 'DOWNSTREAM', 'RELATED_COMPANY']);
  const relationshipPatterns = {
    DEALER: /(?:经销商|经销|授权经销)/,
    AGENT: /(?:代理商|代理机构|授权代理|代理销售)/,
    UPSTREAM: /(?:上游|供应商|供货|配套企业)/,
    DOWNSTREAM: /(?:下游|客户企业|终端客户|采购方)/,
    RELATED_COMPANY: /(?:关联企业|子公司|母公司|集团成员|合作伙伴|战略合作|参股|控股)/,
  };
  const relationshipEvidenceBacked = (targetCompanyName, relatedCompanyName, relationshipType) => {
    const targetIdentity = identity(targetCompanyName);
    const relatedIdentity = identity(relatedCompanyName);
    if (!targetIdentity || !relatedIdentity || !relationshipPatterns[relationshipType]) return false;
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
    const clauses = evidenceText
      .split(/[\n。！？；;]+/)
      .map(identity)
      .filter(Boolean);
    return (templates[relationshipType] || []).some((template) => clauses.some((clause) => (
      new RegExp(`^(?:${template})$`).test(clause)
    )));
  };
  const opportunityEvidenceBacked = (relatedCompanyName, opportunityType, opportunityEvidence) => {
    const relatedIdentity = identity(relatedCompanyName);
    const quoteIdentity = identity(opportunityEvidence);
    if (!relatedIdentity || !quoteIdentity) return false;
    const templates = {
      MANUFACTURING_CAPABILITY: `^${relatedIdentity}(?:正在|计划|拟|将|已|拥有|具备|从事|开展|建设|设有)(?:数控|齿轮|金属|零部件|模具|精密|机械)*(?:制造|生产|机加工|加工车间|工厂|车间)(?:能力|业务|项目|生产线)?$`,
      MACHINING_DEMAND: `^${relatedIdentity}(?:正在|计划|拟|将|已|拥有|具备|从事|开展)(?:数控|齿轮|金属|零部件|模具|精密|机械)*(?:机加工|加工|切削)(?:需求|能力|业务|项目)?$`,
      EQUIPMENT_PURCHASE: `^${relatedIdentity}(?:正在|计划|拟|将|已|启动|发布)(?:采购|求购|招标|购置|询价)(?:数控|齿轮|金属|加工|生产|自动化|新|相关|一批|多台|台|套|高端|大型|精密|国产|进口|智能|专用)*(?:机床|设备|生产线|加工中心|车床|铣床|磨床|钻床|镗床|刨床|插床|滚齿机)(?:并(?:建设|扩建)(?:数控|齿轮|加工|生产|自动化)*(?:车间|生产线))?$`,
      CAPACITY_EXPANSION: `^${relatedIdentity}(?:正在|计划|拟|将|已|启动)(?:扩产|扩建|提升产能|新建生产线|新建车间)(?:项目|计划)?$`,
      TECHNICAL_UPGRADE: `^${relatedIdentity}(?:正在|计划|拟|将|已|启动)(?:技改|技术改造|设备升级|自动化改造)(?:项目|计划)?$`,
    };
    const template = templates[opportunityType];
    if (!template || !new RegExp(template).test(quoteIdentity)) return false;
    return evidenceText
      .split(/[\n。！？；;]+/)
      .map(identity)
      .includes(quoteIdentity);
  };
  const patterns = {
    MANUFACTURING_CAPABILITY: /(?:制造|生产|机加工|加工车间|工厂|车间)/,
    MACHINING_DEMAND: /(?:机加工|加工|切削|齿轮|金属|模具|零部件)/,
    EQUIPMENT_PURCHASE: /(?:采购|求购|招标|购置|询价|设备需求)/,
    CAPACITY_EXPANSION: /(?:扩产|扩建|产能|新建.{0,8}(?:生产线|车间))/,
    TECHNICAL_UPGRADE: /(?:技改|技术改造|升级|自动化改造)/,
  };
  const pattern = patterns[parsed.opportunityType];
  const relationshipPattern = relationshipPatterns[parsed.relationshipType];
  const opportunityEvidence = typeof parsed.opportunityEvidence === 'string' ? parsed.opportunityEvidence.trim() : '';
  const opportunityBacked = relationshipTypes.has(parsed.relationshipType)
    && typeof parsed.matchedCompanyName === 'string'
    && parsed.matchedCompanyName.trim()
    && relationshipPattern
    && pattern
    && opportunityEvidence
    && identity(parsed.matchedCompanyName) !== identity(state.validatedLead.companyName)
    && !evidenceHasQuestion
    && evidenceClauseCount === 3
    && identity(evidenceText).includes(identity(parsed.matchedCompanyName))
    && identity(evidenceText).includes(identity(state.validatedLead.companyName))
    && directContactEvidenceBacked(parsed.matchedCompanyName, [
      { type: 'phone', value: parsed.phone },
      { type: 'email', value: parsed.email },
    ])
    && relationshipEvidenceBacked(state.validatedLead.companyName, parsed.matchedCompanyName, parsed.relationshipType)
    && opportunityEvidenceBacked(parsed.matchedCompanyName, parsed.opportunityType, opportunityEvidence)
    && pattern.test(opportunityEvidence);
  if (!opportunityBacked) return reject('RELATED_OPPORTUNITY_NOT_SUPPORTED');
  return { json: {
    ...state,
    verified: false,
    directContact: false,
    relatedOpportunity: true,
    classification: 'RELATED_OPPORTUNITY',
    status: 'RELATED_OPPORTUNITY_IDENTIFIED',
    lastFailureStatus: null,
    relatedOpportunityFact: {
      matchedCompanyName: parsed.matchedCompanyName.trim(),
      relationshipType: parsed.relationshipType,
      opportunityType: parsed.opportunityType,
      phone: parsed.phone?.trim() || null,
      email: parsed.email?.trim() || null,
      province: province || null,
      city: city || null,
      evidenceUrl,
      contactEvidence: parsed.contactEvidence.trim(),
      opportunityEvidence,
      evidenceResult,
      contactSearchQuery: state.contactSearchQuery,
    },
  } };
}

function buildRelatedLeadV11() {
  const state = $('Apply Contact Verification R' + ROUND).item.json;
  const fact = state.relatedOpportunityFact;
  const fail = (reason) => ({ json: {
    ...state,
    derivedEligible: false,
    contactSearchAllowed: false,
    status: reason,
  } });
  const content = $json?.choices?.[0]?.message?.content;
  let scoredLead = null;
  try { scoredLead = JSON.parse(String(content)); } catch {}
  if (
    !fact
    || !Number.isInteger(scoredLead?.aiScore)
    || scoredLead.aiScore < 0
    || scoredLead.aiScore > 100
    || !scoredLead.profile
    || typeof scoredLead.profile !== 'object'
    || Array.isArray(scoredLead.profile)
  ) return fail('RELATED_OPPORTUNITY_SCORE_INVALID');
  const phoneValid = (value) => typeof value === 'string' && /^\+?[0-9][0-9 ()-]{5,30}[0-9]$/.test(value.trim()) && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15;
  const emailValid = (value) => typeof value === 'string' && value.trim().length <= 191 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  const validatedLead = {
    companyName: fact.matchedCompanyName,
    ...(typeof scoredLead.contactName === 'string' && scoredLead.contactName.trim() ? { contactName: scoredLead.contactName.trim() } : {}),
    ...(fact.phone ? { phone: fact.phone } : {}),
    ...(fact.email ? { email: fact.email } : {}),
    aiScore: scoredLead.aiScore,
    sourceUrl: fact.evidenceUrl,
    searchKeyword: fact.contactSearchQuery,
    profile: {
      ...scoredLead.profile,
      leadOrigin: 'RELATED_OPPORTUNITY',
      relatedToCompanyName: state.validatedLead.companyName,
      relationshipType: fact.relationshipType,
      opportunityType: fact.opportunityType,
      opportunityEvidence: fact.opportunityEvidence,
      contactEvidence: fact.contactEvidence,
      ...(fact.province ? { province: fact.province } : {}),
      ...(fact.city ? { city: fact.city } : {}),
    },
  };
  const derivedEligible = scoredLead.aiScore >= 80 && (phoneValid(validatedLead.phone) || emailValid(validatedLead.email));
  return { json: {
    ...state,
    validatedLead,
    derivedEligible,
    contactSearchAllowed: false,
    status: derivedEligible ? 'RELATED_OPPORTUNITY_READY' : 'RELATED_OPPORTUNITY_BELOW_ENTRY_GATE',
  } };
}

function resumeOriginalLeadV11() {
  const original = $('Apply Contact Verification R' + ROUND).item.json;
  const fact = original.relatedOpportunityFact;
  const derivedOutcomes = Array.isArray(original.derivedOutcomes) ? [...original.derivedOutcomes] : [];
  const derivedEvidenceUrls = Array.isArray(original.derivedEvidenceUrls) ? [...original.derivedEvidenceUrls] : [];
  if (fact?.matchedCompanyName) {
    derivedOutcomes.push({ companyName: fact.matchedCompanyName, contactSearchRound: ROUND, processed: true });
  }
  if (fact?.evidenceUrl && !derivedEvidenceUrls.includes(fact.evidenceUrl)) derivedEvidenceUrls.push(fact.evidenceUrl);
  return { json: {
    ...original,
    verified: false,
    directContact: false,
    relatedOpportunity: false,
    derivedOutcomes,
    derivedEvidenceUrls,
    status: 'RELATED_OPPORTUNITY_PROCESSED',
  } };
}

function finalLeadEntryGate() {
  const phoneValid = (value) => typeof value === 'string' && /^\+?[0-9][0-9 ()-]{5,30}[0-9]$/.test(value.trim()) && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15;
  const emailValid = (value) => typeof value === 'string' && value.trim().length <= 191 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  return $input.all().map((item, index) => {
    const lead = item.json.validatedLead;
    const shouldWrite = Number.isInteger(Number(lead?.aiScore)) && Number(lead.aiScore) >= 80 && (phoneValid(lead?.phone) || emailValid(lead?.email));
    return { json: { ...item.json, shouldWrite, status: shouldWrite ? item.json.status : 'CONTACT_NOT_VERIFIED' }, pairedItem: { item: index } };
  });
}

function validateLeadMcpResult() {
  return $input.all().map((item, index) => {
    const result = item.json?.result;
    const structured = result?.structuredContent;
    const leadWriteResult = structured?.data?.items?.[0];
    const businessSuccess = result?.isError !== true
      && structured?.ok === true
      && typeof leadWriteResult?.id === 'string';
    if (!businessSuccess) {
      const errorCode = typeof structured?.error?.code === 'string'
        ? structured.error.code
        : 'MCP_RESPONSE_INVALID';
      throw new Error(`LEAD_MCP_WRITE_FAILED item=${index} code=${errorCode}`);
    }
    return {
      json: { ...item.json, leadWriteResult },
      pairedItem: { item: index },
    };
  });
}

function exhaustedLead() {
  return $input.all().map((item, index) => ({ json: {
    ...item.json,
    shouldWrite: false,
    shouldSearch: false,
    verified: false,
    status: 'CONTACT_ENRICHMENT_EXHAUSTED',
  }, pairedItem: { item: index } }));
}

function terminalLead() {
  return $input.all().map((item, index) => ({ json: { ...item.json, shouldWrite: false, shouldSearch: false }, pairedItem: { item: index } }));
}

const codeSource = (fn, prefix = "") => `${prefix}return (${fn.toString()})();`;

function codeNode(name, id, position, fn, prefix = "") {
  return {
    parameters: { mode: "runOnceForAllItems", jsCode: codeSource(fn, prefix) },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    id,
    name,
  };
}

function ifNode(name, id, position, leftValue) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{ id: `${id}-condition`, leftValue, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    id,
    name,
  };
}

function httpNode(name, id, position, { url, jsonBody, credentialId, credentialName }) {
  return {
    parameters: {
      method: "POST",
      url,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      options: { response: { response: { neverError: true, responseFormat: "json" } }, timeout: 30000 },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    id,
    name,
    onError: "continueRegularOutput",
    credentials: { httpHeaderAuth: { id: credentialId, name: credentialName } },
  };
}

const connect = (node, index = 0) => ({ node, type: "main", index });
const outputs = (trueNode, falseNode) => [[connect(trueNode)], [connect(falseNode)]];

export function buildContactEnrichmentWorkflow(baseWorkflow) {
  const workflow = structuredClone(baseWorkflow);
  workflow.name = "百度获客-联系方式反查-v1";
  workflow.active = false;
  workflow.id = "baidu-lead-contact-enrichment-v1";
  workflow.versionId = "7bf4e90f-62c9-4c4c-a152-6b6af4219ca1";
  workflow.meta = { templateCredsSetupCompleted: false };
  workflow.settings = {
    ...workflow.settings,
    saveExecutionProgress: false,
    saveDataErrorExecution: "none",
    saveDataSuccessExecution: "none",
    executionTimeout: 900,
  };
  const config = workflow.nodes.find((node) => node.name === "Search Config");
  config.parameters.assignments.assignments.push(
    { id: "contact-search-enabled", name: "contact_search_enabled", value: true, type: "boolean" },
    { id: "contact-search-threshold", name: "contact_search_score_threshold", value: 90, type: "number" },
    { id: "contact-search-rounds", name: "contact_search_max_rounds", value: 3, type: "number" },
    { id: "contact-search-top-k", name: "contact_search_top_k", value: 5, type: "number" },
  );
  const leadPayload = workflow.nodes.find((node) => node.name === "Lead MCP Payload");
  leadPayload.parameters.assignments.assignments.push(
    { id: "lead-contact-name", name: "contactName", value: "={{ $json.validatedLead.contactName }}", type: "string" },
    { id: "lead-contact-phone", name: "phone", value: "={{ $json.validatedLead.phone }}", type: "string" },
    { id: "lead-contact-email", name: "email", value: "={{ $json.validatedLead.email }}", type: "string" },
  );
  const leadAgent = workflow.nodes.find((node) => node.name === "HTTP Request1");
  leadAgent.parameters.jsonBody = leadAgent.parameters.jsonBody.replace(
    /"appId":\s*"[^"]+"/u,
    '"appId": "REPLACE_FASTGPT_LEAD_AGENT_APP_ID"',
  );
  const leadMcpUpsert = workflow.nodes.find((node) => node.name === "Lead MCP Upsert");

  const nodes = [
    codeNode("Contact Entry Gate", "contact-entry-gate", [1024, 320], contactEntryGate),
    ifNode("Lead Already Eligible?", "lead-already-eligible", [1248, 320], "={{ $json.shouldWrite }}"),
    ifNode("Should Start Contact Search?", "should-start-contact-search", [1456, 464], "={{ $json.shouldSearch }}"),
    codeNode("Final Lead Entry Gate", "final-lead-entry-gate", [3264, -240], finalLeadEntryGate),
    ifNode("Final Lead Eligible?", "final-lead-eligible", [3472, -240], "={{ $json.shouldWrite }}"),
    codeNode("Contact Enrichment Terminal", "contact-enrichment-terminal", [3712, 624], terminalLead),
    codeNode("Contact Enrichment Exhausted", "contact-enrichment-exhausted", [3264, 624], exhaustedLead),
    codeNode(
      "Validate Lead MCP Result",
      "validate-lead-mcp-result",
      [leadMcpUpsert.position[0] + 208, leadMcpUpsert.position[1]],
      validateLeadMcpResult,
    ),
  ];

  for (const round of [1, 2, 3]) {
    const x = 1680 + (round - 1) * 768;
    nodes.push(
      codeNode(`Prepare Contact Round ${round}`, `prepare-contact-round-${round}`, [x, 464], prepareContactRound, `const ROUND = ${round};\nconst PROVINCE_CITY_MAP = ${JSON.stringify(CRM_PROVINCE_CITY_MAP)};\n`),
      ifNode(`Contact Round ${round} Budget Allowed?`, `contact-round-${round}-budget`, [x + 192, 464], "={{ $json.budgetAllowed }}"),
    );
    if (round > 1) {
      nodes.push(
        httpNode(`AI Query Planner R${round}`, `ai-query-planner-r${round}`, [x + 384, 368], {
          url: "http://fastgpt-app:3000/api/v1/chat/completions",
          jsonBody: `={{ { appId: 'REPLACE_FASTGPT_QUERY_PLANNER_APP_ID', chatId: 'contact-query-' + $execution.id + '-r${round}-' + $itemIndex, stream: false, detail: false, messages: [{ role: 'user', content: JSON.stringify({ companyName: $json.validatedLead.companyName, industry: $json.validatedLead.profile?.industry ?? null, businessScope: $json.validatedLead.profile?.businessScope ?? null, province: $json.validatedLead.profile?.province ?? null, city: $json.validatedLead.profile?.city ?? null, sourceUrl: $json.validatedLead.sourceUrl ?? null, searchKeyword: $json.validatedLead.searchKeyword ?? null, previousQueries: $json.previousQueries, previousResults: $json.excludedResults, contactSearchRound: $json.contactSearchRound }) }] } }}`,
          credentialId: "REPLACE_FASTGPT_QUERY_PLANNER_CREDENTIAL",
          credentialName: "FastGPT Contact Query Planner",
        }),
        codeNode(`Parse Query Planner R${round}`, `parse-query-planner-r${round}`, [x + 576, 368], parseQueryPlanner, `const ROUND = ${round};\n`),
        ifNode(`Query Planner R${round} Valid?`, `query-planner-r${round}-valid`, [x + 768, 368], "={{ $json.plannerValid }}"),
      );
    }
    nodes.push(
      httpNode(`Baidu Contact Search R${round}`, `baidu-contact-search-r${round}`, [x + (round === 1 ? 384 : 960), 464], {
        url: "https://qianfan.baidubce.com/v2/ai_search/web_search",
        jsonBody: "={{ { messages: [{ role: 'user', content: $json.contactSearchQuery }], search_source: 'baidu_search_v2', resource_type_filter: [{ type: 'web', top_k: Math.min(Number($('Search Config').first().json.contact_search_top_k), 5) }] } }}",
        credentialId: "REPLACE_BAIDU_SEARCH_CREDENTIAL",
        credentialName: "Header Auth account",
      }),
      codeNode(`Extract Contact Candidates R${round}`, `extract-contact-candidates-r${round}`, [x + (round === 1 ? 576 : 1152), 464], extractContactCandidates, `const ROUND = ${round};\n`),
      ifNode(`Contact Candidates R${round}?`, `contact-candidates-r${round}`, [x + (round === 1 ? 768 : 1344), 464], "={{ $json.hasCandidates }}"),
      httpNode(`AI Contact Verifier R${round}`, `ai-contact-verifier-r${round}`, [x + (round === 1 ? 960 : 1536), 368], {
        url: "http://fastgpt-app:3000/api/v1/chat/completions",
        jsonBody: `={{ { appId: 'REPLACE_FASTGPT_CONTACT_VERIFIER_APP_ID', chatId: 'contact-verify-' + $execution.id + '-r${round}-' + $itemIndex, stream: false, detail: false, messages: [{ role: 'user', content: JSON.stringify({ targetCompanyName: $json.validatedLead.companyName, province: $json.validatedLead.profile?.province ?? null, city: $json.validatedLead.profile?.city ?? null, targetProfile: $json.validatedLead.profile ?? null, candidatePhones: $json.candidatePhones, candidateEmails: $json.candidateEmails, searchResults: $json.searchResults, contactSearchRound: $json.contactSearchRound }) }] } }}`,
        credentialId: "REPLACE_FASTGPT_CONTACT_VERIFIER_CREDENTIAL",
        credentialName: "FastGPT Contact Verifier",
      }),
      codeNode(`Apply Contact Verification R${round}`, `apply-contact-verification-r${round}`, [x + (round === 1 ? 1152 : 1728), 368], applyContactVerification, `const ROUND = ${round};\nconst PROVINCE_CITY_MAP = ${JSON.stringify(CRM_PROVINCE_CITY_MAP)};\n`),
      ifNode(`Contact Verified R${round}?`, `contact-verified-r${round}`, [x + (round === 1 ? 1344 : 1920), 368], "={{ $json.verified }}"),
    );
  }
  workflow.nodes.push(...nodes);

  workflow.connections["Code in JavaScript1"] = { main: [[connect("Contact Entry Gate")]] };
  workflow.connections["Contact Entry Gate"] = { main: [[connect("Lead Already Eligible?")]] };
  workflow.connections["Lead Already Eligible?"] = { main: outputs("Final Lead Entry Gate", "Should Start Contact Search?") };
  workflow.connections["Should Start Contact Search?"] = { main: outputs("Prepare Contact Round 1", "Contact Enrichment Terminal") };
  workflow.connections["Final Lead Entry Gate"] = { main: [[connect("Final Lead Eligible?")]] };
  workflow.connections["Final Lead Eligible?"] = { main: outputs("Lead MCP Payload", "Contact Enrichment Terminal") };
  workflow.connections["Contact Enrichment Terminal"] = { main: [[]] };
  workflow.connections["Contact Enrichment Exhausted"] = { main: [[]] };
  workflow.connections["Lead MCP Upsert"] = { main: [[connect("Validate Lead MCP Result")]] };
  workflow.connections["Validate Lead MCP Result"] = { main: [[]] };

  for (const round of [1, 2, 3]) {
    const next = round < 3 ? `Prepare Contact Round ${round + 1}` : "Contact Enrichment Exhausted";
    workflow.connections[`Prepare Contact Round ${round}`] = { main: [[connect(`Contact Round ${round} Budget Allowed?`)]] };
    workflow.connections[`Contact Round ${round} Budget Allowed?`] = {
      main: outputs(round === 1 ? "Baidu Contact Search R1" : `AI Query Planner R${round}`, "Contact Enrichment Exhausted"),
    };
    if (round > 1) {
      workflow.connections[`AI Query Planner R${round}`] = { main: [[connect(`Parse Query Planner R${round}`)]] };
      workflow.connections[`Parse Query Planner R${round}`] = { main: [[connect(`Query Planner R${round} Valid?`)]] };
      workflow.connections[`Query Planner R${round} Valid?`] = { main: outputs(`Baidu Contact Search R${round}`, "Contact Enrichment Terminal") };
    }
    workflow.connections[`Baidu Contact Search R${round}`] = { main: [[connect(`Extract Contact Candidates R${round}`)]] };
    workflow.connections[`Extract Contact Candidates R${round}`] = { main: [[connect(`Contact Candidates R${round}?`)]] };
    workflow.connections[`Contact Candidates R${round}?`] = { main: outputs(`AI Contact Verifier R${round}`, next) };
    workflow.connections[`AI Contact Verifier R${round}`] = { main: [[connect(`Apply Contact Verification R${round}`)]] };
    workflow.connections[`Apply Contact Verification R${round}`] = { main: [[connect(`Contact Verified R${round}?`)]] };
    workflow.connections[`Contact Verified R${round}?`] = { main: outputs("Final Lead Entry Gate", next) };
  }
  return workflow;
}

function relatedWriteNodes(workflow, round) {
  const sourceNames = [
    "Lead MCP Payload",
    "Canonical Lead Payload",
    "Lead Payload SHA256",
    "Lead Idempotency SHA256",
    "Finalize Lead MCP Item",
    "Build Lead Upsert Args",
    "Lead MCP Upsert",
    "Validate Lead MCP Result",
  ];
  const relatedNames = [
    `Related Lead MCP Payload R${round}`,
    `Related Canonical Lead Payload R${round}`,
    `Related Lead Payload SHA256 R${round}`,
    `Related Lead Idempotency SHA256 R${round}`,
    `Related Finalize Lead MCP Item R${round}`,
    `Related Build Lead Upsert Args R${round}`,
    `Related Lead MCP Upsert R${round}`,
    `Related Validate Lead MCP Result R${round}`,
  ];
  const laneY = 960 + (round - 1) * 320;
  const nodes = sourceNames.map((sourceName, index) => {
    const source = workflow.nodes.find((node) => node.name === sourceName);
    const node = structuredClone(source);
    node.name = relatedNames[index];
    node.id = `related-${round}-${index}-${source.id}`;
    node.position = [1680 + index * 208, laneY];
    return node;
  });
  const payload = nodes[0];
  for (const assignment of payload.parameters.assignments.assignments) {
    if (assignment.name === "sourceUrl") assignment.value = "={{ $json.validatedLead.sourceUrl }}";
  }
  payload.parameters.assignments.assignments.push({
    id: `related-extractor-version-${round}`,
    name: "extractorVersion",
    value: "contact-related-opportunity-v1.1",
    type: "string",
  });
  return { nodes, names: relatedNames };
}

export function buildRelatedOpportunityWorkflow(v1Workflow) {
  const workflow = structuredClone(v1Workflow);
  workflow.name = "百度获客-联系方式反查-v1.1-关联潜客";
  workflow.active = false;
  workflow.id = "baidu-lead-contact-enrichment-v1-1";
  workflow.versionId = "6d51e4dc-f3dd-4f7b-b355-28a8eea127c1";
  const addedNodes = [];

  for (const round of [1, 2, 3]) {
    const next = round < 3 ? `Prepare Contact Round ${round + 1}` : "Contact Enrichment Exhausted";
    const verifier = workflow.nodes.find((node) => node.name === `AI Contact Verifier R${round}`);
    verifier.parameters.jsonBody = verifier.parameters.jsonBody.replace(
      "REPLACE_FASTGPT_CONTACT_VERIFIER_APP_ID",
      "REPLACE_FASTGPT_CONTACT_VERIFIER_V11_APP_ID",
    );
    verifier.credentials.httpHeaderAuth = {
      id: "REPLACE_FASTGPT_CONTACT_VERIFIER_V11_CREDENTIAL",
      name: "FastGPT Contact Verifier v1.1",
    };
    const apply = workflow.nodes.find((node) => node.name === `Apply Contact Verification R${round}`);
    apply.parameters.jsCode = codeSource(
      applyContactDispositionV11,
      `const ROUND = ${round};\nconst PROVINCE_CITY_MAP = ${JSON.stringify(CRM_PROVINCE_CITY_MAP)};\n`,
    );

    const laneY = 800 + (round - 1) * 320;
    const relatedIf = ifNode(
      `Related Opportunity R${round}?`,
      `related-opportunity-r${round}`,
      [3264, laneY],
      "={{ $json.relatedOpportunity }}",
    );
    const score = httpNode(`AI Score Related Opportunity R${round}`, `ai-score-related-r${round}`, [3472, laneY], {
      url: "http://fastgpt-app:3000/api/v1/chat/completions",
      jsonBody: `={{ { appId: 'REPLACE_FASTGPT_LEAD_AGENT_APP_ID', chatId: 'related-lead-score-' + $execution.id + '-r${round}-' + $itemIndex, stream: false, detail: false, variables: { companyName: $json.relatedOpportunityFact.matchedCompanyName, searchKeyword: $json.relatedOpportunityFact.contactSearchQuery, searchTitle: $json.relatedOpportunityFact.evidenceResult.title, sourceUrl: $json.relatedOpportunityFact.evidenceUrl, sourceDate: '', rawContent: JSON.stringify({ contactEvidence: $json.relatedOpportunityFact.contactEvidence, opportunityEvidence: $json.relatedOpportunityFact.opportunityEvidence, source: $json.relatedOpportunityFact.evidenceResult }), sourceSite: $json.relatedOpportunityFact.evidenceResult.domain, sourceType: 'RELATED_OPPORTUNITY' }, messages: [{ role: 'user', content: '独立评估该关联企业的机床潜客价值并输出 validatedLead；不得替换已验证的企业名称和联系方式。' }] } }}`,
      credentialId: "REPLACE_FASTGPT_LEAD_AGENT_CREDENTIAL",
      credentialName: "FastGPT Lead Agent",
    });
    const build = codeNode(
      `Build Related Lead R${round}`,
      `build-related-lead-r${round}`,
      [3680, laneY],
      buildRelatedLeadV11,
      `const ROUND = ${round};\n`,
    );
    const eligible = ifNode(
      `Related Lead Eligible R${round}?`,
      `related-lead-eligible-r${round}`,
      [3888, laneY],
      "={{ $json.derivedEligible }}",
    );
    const resume = codeNode(
      `Resume Original Lead R${round}`,
      `resume-original-lead-r${round}`,
      [4096, laneY + 128],
      resumeOriginalLeadV11,
      `const ROUND = ${round};\n`,
    );
    const write = relatedWriteNodes(workflow, round);
    addedNodes.push(relatedIf, score, build, eligible, resume, ...write.nodes);

    workflow.connections[`Contact Verified R${round}?`] = { main: outputs("Final Lead Entry Gate", relatedIf.name) };
    workflow.connections[relatedIf.name] = { main: outputs(score.name, next) };
    workflow.connections[score.name] = { main: [[connect(build.name)]] };
    workflow.connections[build.name] = { main: [[connect(eligible.name)]] };
    workflow.connections[eligible.name] = { main: outputs(write.names[0], resume.name) };
    for (let index = 0; index < write.names.length - 1; index += 1) {
      workflow.connections[write.names[index]] = { main: [[connect(write.names[index + 1])]] };
    }
    workflow.connections[write.names.at(-1)] = { main: [[connect(resume.name)]] };
    workflow.connections[resume.name] = { main: [[connect(next)]] };
  }
  workflow.nodes.push(...addedNodes);
  return workflow;
}

export function writeContactEnrichmentWorkflow() {
  const baseWorkflow = JSON.parse(readFileSync(basePath, "utf8"));
  const workflow = buildContactEnrichmentWorkflow(baseWorkflow);
  writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  return outputPath;
}

export function writeRelatedOpportunityWorkflow() {
  const baseWorkflow = JSON.parse(readFileSync(basePath, "utf8"));
  const v1Workflow = buildContactEnrichmentWorkflow(baseWorkflow);
  const workflow = buildRelatedOpportunityWorkflow(v1Workflow);
  writeFileSync(relatedOutputPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  return relatedOutputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  writeContactEnrichmentWorkflow();
  writeRelatedOpportunityWorkflow();
}
