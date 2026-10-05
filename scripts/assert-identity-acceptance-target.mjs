const expectedDatabase = "dachuan_identity_acceptance";
const databaseUrl = new URL(process.env.DATABASE_URL || "");
const actualDatabase = databaseUrl.pathname.replace(/^\//, "");
if (
  process.env.IDENTITY_ACCEPTANCE_ENV !== "isolated"
  || process.env.COMPOSE_PROJECT_NAME !== "dachuan-identity-acceptance"
  || process.env.IDENTITY_ACCEPTANCE_DATABASE_NETWORK !== "identity-data"
  || databaseUrl.hostname !== "mysql"
  || databaseUrl.port !== "3306"
  || actualDatabase !== expectedDatabase
  || process.env.MYSQL_DATABASE !== expectedDatabase
) {
  throw new Error("Refusing database operation: target is not the fixed isolated acceptance database");
}
console.log("IDENTITY_ACCEPTANCE_DATABASE_TARGET=VERIFIED");
