import Link from "next/link";
import { signUp } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth-shell">
      <p className="eyebrow">Ship Check · Cloud</p>
      <h1 className="auth-title">Create an account</h1>
      <p className="lede">Cloud starts with source-free assurance metadata. Your source stays where Ship Check ran.</p>
      {error ? <p className="error-note">{error}</p> : null}
      <form action={signUp} className="stack-form">
        <label>Name<input name="name" type="text" autoComplete="name" /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <button type="submit">Create account</button>
      </form>
      <p className="small-note">Already have an account? <Link href="/auth/sign-in">Sign in</Link>.</p>
    </main>
  );
}
