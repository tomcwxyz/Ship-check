"use client";

import { useState } from "react";

export default function SignOut() {
  const [busy,setBusy] = useState(false);
  return <button type="button" className="auth-switch" disabled={busy} onClick={async()=>{
    setBusy(true);
    try { await fetch("/api/auth/sign-out", {method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"}); }
    finally { window.location.assign("/auth"); }
  }}>Sign out</button>;
}
