import Link from "next/link";
import { signIn } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth-shell">
      <p className="eyebrow">Ship Check · Cloud</p>
      <h1 className="auth-title">Sign in</h1>
      <p className="lede">See the assurance history you chose to keep in Cloud.</p>
      {error ? <p className="error-note">{error}</p> : null}
      <form action={signIn} className="stack-form">
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
        <button type="submit">Sign in</button>
      </form>
      <p className="small-note">New here? <Link href="/auth/sign-up">Create an account</Link>.</p>
    </main>
  );
}
