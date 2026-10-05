import {
  acceptanceLoginUsers,
  runAcceptanceLoginPreflight,
} from "./identity-acceptance-crm-login";

if (process.env.IDENTITY_ACCEPTANCE_ENV !== "isolated") {
  throw new Error("Refusing to run outside IDENTITY_ACCEPTANCE_ENV=isolated");
}

const required = (name: string) => {
  const value = String(process.env[name] || "").trim();
  if (!value || value.startsWith("REPLACE_") || value.startsWith("GENERATE_")) {
    throw new Error(`${name} is not configured`);
  }
  return value;
};

const users = acceptanceLoginUsers(process.env);
const result = await runAcceptanceLoginPreflight({
  crmUrl: required("ACCEPTANCE_CRM_URL"),
  password: required("ACCEPTANCE_USER_PASSWORD"),
  users,
});

if (result.diagnostics.length !== 6 || result.sessionsByUserId.size !== 6) {
  throw new Error("Identity login preflight did not verify all six isolated users");
}

console.log("IDENTITY_LOGIN_PREFLIGHT_RESULT=PASS users=6");
