import * as pulumi from "@pulumi/pulumi";

export interface SentrySettings {
    dsn?: pulumi.Output<string>;
    environment: string;
    release?: string;
}

export function getSentrySettings(prefix = "sentry"): SentrySettings {
    const cfg = new pulumi.Config();
    const dsn = cfg.getSecret(`${prefix}.dsn`);
    const environment = cfg.get(`${prefix}.environment`) || pulumi.getStack();
    const release = cfg.get(`${prefix}.release`);
    return { dsn: dsn || undefined, environment, release };
}

export function toEnvVars(s: SentrySettings): Record<string, pulumi.Input<string>> {
    const env: Record<string, pulumi.Input<string>> = {
        SENTRY_ENVIRONMENT: s.environment,
    };
    if (s.dsn) env["SENTRY_DSN"] = s.dsn;
    if (s.release) env["SENTRY_RELEASE"] = s.release;
    return env;
}

