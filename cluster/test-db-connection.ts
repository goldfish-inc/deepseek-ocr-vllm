import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();
const dbUrl = cfg.requireSecret("labelStudioDbUrl");

// Output the URL (will be masked as secret)
export const databaseUrl = dbUrl;

// Test if URL has correct format
export const urlCheck = dbUrl.apply(url => {
    const checks = {
        hasPostgresql: url.startsWith("postgresql://"),
        hasLabelfish: url.includes("/labelfish"),
        hasSslMode: url.includes("sslmode=require"),
        hasCorrectUser: url.includes("u_ogfzdegyvvaj3g4iyuvlu5yxmi")
    };
    const allPassed = Object.values(checks).every(v => v);
    return { checks, allPassed };
});
