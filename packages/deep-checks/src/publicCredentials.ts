// Classification only: decoding a JWT never verifies its signature or database permissions.
export function isPublicSupabaseMatch(text: string, line: number, rule: string): boolean {
  if (!/^(jwt|generic-api-key|supabase-anon-key)$/.test(rule)) return false;
  if (!/import\s*\{\s*createClient\s*\}\s*from\s*['"]@supabase\/supabase-js['"]/.test(text)) return false;
  const sourceLine = text.split(/\r?\n/)[line - 1] ?? "";
  const assignment = /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*['"]([^'"]+)['"];?\s*$/.exec(sourceLine);
  if (!assignment) return false;
  const [, variable, value] = assignment;
  if (!variable || !value || !new RegExp(`createClient\\s*\\(\\s*\\w+\\s*,\\s*${variable}\\s*[,)]`).test(text)) return false;
  if (!/https:\/\/[a-z0-9]+\.supabase\.co/.test(text)) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1]!, "base64url").toString("utf8"));
    return payload.iss === "supabase" && payload.role === "anon";
  } catch { return false; }
}
