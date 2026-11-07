const warned = new Set<string>();
export function leadRuntimeFlags(environment: Record<string, string | undefined> = process.env) {
  const production = environment.NODE_ENV === "production";
  for (const name of ["LEAD_TYC_MOCK", "LEAD_HUNTER_FAKE_SEARCH"]) {
    if (production && environment[name]?.trim() === "1" && !warned.has(name)) {
      warned.add(name);
      console.error(`[lead-hunter] 生产环境已忽略 ${name} 模拟开关`);
    }
  }
  return {
    fakeSearchMode: !production && environment.LEAD_HUNTER_FAKE_SEARCH?.trim() === "1",
    tycMockMode: !production && environment.LEAD_TYC_MOCK?.trim() === "1",
  };
}
export function tycConfigured() {
  return Boolean(process.env.LEAD_TYC_TOKEN?.trim()) || leadRuntimeFlags().tycMockMode;
}
