"use client";

import { useState } from "react";

type Mode = "sign-in" | "sign-up";

export default function SignInPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(
        mode === "sign-in" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(mode === "sign-up" ? { name } : {})
          })
        }
      );
      const data: unknown = await response.json();
      const payload = data && typeof data === "object"
        ? data as { message?: string; error?: string | { message?: string } }
        : {};
      if (!response.ok || payload.error) {
        const message = typeof payload.error === "string"
          ? payload.error
          : payload.error?.message;
        throw new Error(message || payload.message || "Could not sign in. Please check your details.");
      }
      window.location.assign("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setWorking(false);
    }
  }

  return <main className="auth-page">
    <a className="auth-back" href="/">← Ship Check Cloud</a>
    <section className="auth-card">
      <p className="eyebrow">SHIP CHECK CLOUD · ALPHA 12</p>
      <h1>{mode === "sign-in" ? "Welcome back." : "Create an account."}</h1>
      <p className="auth-subtitle">Your scan history stays private to your account. Source code is never uploaded here.</p>
      <form onSubmit={submit}>
        {mode === "sign-up" && <label>Display name
          <input autoComplete="name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} />
        </label>}
        <label>Email address
          <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="auth-primary" disabled={working}>
          {working ? "Checking…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button type="button" className="auth-switch" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); }}>
        {mode === "sign-in" ? "New to Ship Check? Create an account" : "Already registered? Sign in"}
      </button>
      <p className="auth-help">Email and password only in Alpha 12. No Google sign-in is required.</p>
    </section>
  </main>;
}
