function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`;
}

const HIDDEN_FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "scope",
  "resource",
  "code_challenge",
  "code_challenge_method",
];

export function renderLoginPage(params: Record<string, string>, error = ""): string {
  const hiddenInputs = HIDDEN_FIELDS.map((name) => hidden(name, params[name] ?? "")).join(
    "\n"
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect webshop account</title>
    <style>
      :root { color: #18181b; font-family: Inter, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f7; }
      main { width: min(420px, calc(100vw - 32px)); background: white; border: 1px solid #d9dde5; border-radius: 8px; padding: 24px; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 8px; font-size: 1.25rem; }
      p { margin: 0 0 18px; color: #525866; line-height: 1.4; }
      label { display: block; margin: 14px 0 6px; font-size: 0.9rem; font-weight: 600; }
      input { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1px solid #c7ccd6; border-radius: 6px; font: inherit; }
      button { width: 100%; margin-top: 18px; padding: 11px 14px; border: 0; border-radius: 6px; background: #111827; color: white; font-weight: 700; cursor: pointer; }
      .error { margin: 0 0 14px; padding: 10px 12px; border-radius: 6px; background: #fff1f2; color: #9f1239; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Connect webshop account</h1>
      <p>Sign in with your webshop customer account to let ChatGPT read your orders.</p>
      ${error ? `<div class="error">${htmlEscape(error)}</div>` : ""}
      <form method="post" action="/oauth/login">
        ${hiddenInputs}
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Connect account</button>
      </form>
    </main>
  </body>
</html>`;
}
