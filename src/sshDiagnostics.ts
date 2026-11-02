import { homedir } from 'node:os';
import type { ResolvedSshConfig } from './sshConfig';

export type SshStage = 'environment' | 'config' | 'tcp' | 'handshake' | 'trust' | 'agent' | 'key' | 'password' | 'sftp' | 'directory';

/** Structured events only: never attach ssh2 debug output, config stdout or auth objects. */
export class SshDiagnostics {
  private readonly redactions = new Map<string, string>([[homedir(), '~'], [homedir().replace(/\\/g, '/'), '~']]);
  private readonly secrets = new Set<string>();

  constructor(private readonly write: (line: string) => void = () => {}) {}

  hide(value: string | undefined, replacement = '<redacted>'): void {
    if (value) this.redactions.set(value, replacement);
  }

  secret(value: string | undefined): void { if (value) this.secrets.add(value); }

  clearSecrets(): void { this.secrets.clear(); }

  configure(config: ResolvedSshConfig): void {
    this.hide(config.alias, '<server>');
    this.hide(config.host, '<host>');
    this.hide(config.username, '<user>');
    this.event('config', 'resolved', {
      ...config, identityFiles: config.identityFiles, knownHostsFiles: config.knownHostsFiles
    });
  }

  private redact(value: string): string {
    let result = value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '<private-key>');
    // Credentials may contain a host or username: remove them before replacing those substrings.
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) result = result.split(secret).join('<credential>');
    // Longest first prevents a username replacement from breaking home-directory redaction.
    for (const [secret, replacement] of [...this.redactions].sort((a, b) => b[0].length - a[0].length)) {
      result = result.split(secret).join(replacement);
    }
    return result.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 2000);
  }

  event(stage: SshStage, event: string, fields: Record<string, unknown> = {}, error?: unknown): void {
    const sanitize = (value: unknown): unknown => {
      if (typeof value === 'string') return this.redact(value);
      if (Array.isArray(value)) return value.map(sanitize);
      if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value;
      return undefined;
    };
    const details: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) details[key] = sanitize(value);
    if (error instanceof Error) {
      const describe = (cause: Error) => {
        const source = cause as Error & { code?: unknown; level?: unknown };
        return { code: sanitize(source.code), level: sanitize(source.level), message: this.redact(source.message) };
      };
      details.error = describe(error);
      if (error.cause instanceof Error) details.cause = describe(error.cause);
    }
    this.write(JSON.stringify({ stage, event, ...details }));
  }
}
