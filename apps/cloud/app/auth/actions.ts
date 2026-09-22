"use server";

import { redirect } from "next/navigation";
import { auth } from "../../lib/auth/server";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function signIn(formData: FormData): Promise<void> {
  const email = value(formData, "email");
  const password = value(formData, "password");
  const result = await auth.signIn.email({ email, password });
  if (result.error) {
    redirect(`/auth/sign-in?error=${encodeURIComponent(result.error.message || "Sign in failed")}`);
  }
  redirect("/projects");
}

export async function signUp(formData: FormData): Promise<void> {
  const name = value(formData, "name") || "Ship Check user";
  const email = value(formData, "email");
  const password = value(formData, "password");
  const result = await auth.signUp.email({ name, email, password });
  if (result.error) {
    redirect(`/auth/sign-up?error=${encodeURIComponent(result.error.message || "Sign up failed")}`);
  }
  redirect("/projects");
}

export async function signOut(): Promise<void> {
  await auth.signOut();
  redirect("/");
}
