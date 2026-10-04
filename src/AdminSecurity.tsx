import { useEffect, useState } from "react";
import { api } from "./types";
export function RecoveryCodes({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          "听屿管理员一次性恢复码\n请保存在安全位置，每个码只能使用一次。\n\n" +
            codes.join("\n"),
        ],
        { type: "text/plain;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "tingyu-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="security-panel">
      <h2>保存一次性恢复码</h2>
      <p>
        手机丢失时，可使用管理员密码与其中一个恢复码登录。仅在此显示一次，请离线安全保存。
      </p>
      <pre className="recovery-codes">{codes.join("\n")}</pre>
      <button className="secondary" onClick={download}>
        下载恢复码
      </button>
      <label className="check-label">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        我已安全保存恢复码
      </label>
      <button className="primary" disabled={!saved} onClick={onDone}>
        完成，进入后台
      </button>
    </section>
  );
}
export default function AdminSecurity({
  setup = false,
  onDone,
}: {
  setup?: boolean;
  onDone?: () => void;
}) {
  const [info, setInfo] = useState<{
      enabled: boolean;
      remaining: number;
    } | null>(null),
    [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [codes, setCodes] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!setup)
      void api<typeof info>("/api/admin/mfa")
        .then(setInfo)
        .catch((e) => setError(e.message));
  }, [setup]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      setEnroll(await api("/api/admin/mfa/setup", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ codes: string[] }>(
        enroll ? "/api/admin/mfa/confirm" : "/api/admin/mfa/recovery",
        { method: "POST", body: JSON.stringify({ password, code }) },
      );
      setCodes(r.codes);
      setPassword("");
      setCode("");
      setEnroll(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (codes.length)
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes([]);
          setInfo({ enabled: true, remaining: 10 });
          onDone?.();
        }}
      />
    );
  return (
    <section className="security-panel">
      <h2>Google Authenticator 二次验证</h2>
      <p>
        登录需要管理员密码与 6
        位动态验证码。二维码和密钥仅在当前页面生成，请勿分享。手机与服务器需保持时间同步。
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {(setup || info?.enabled === false) && !enroll && (
        <>
          <p>请先完成绑定，再管理作品。</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void start()}
          >
            开始绑定验证器
          </button>
        </>
      )}
      {enroll && (
        <>
          <img
            width="240"
            height="240"
            src={enroll.qr}
            alt="Google Authenticator 绑定二维码"
          />
          <p>在验证器中选择“添加账号 → 扫描二维码”。无法扫码可手动输入密钥：</p>
          <code className="mfa-secret">{enroll.secret}</code>
          <p>绑定页面 10 分钟内有效。</p>
        </>
      )}
      {info?.enabled && (
        <>
          <p>已启用 · 剩余恢复码 {info.remaining} 个</p>
          <p>重新生成后旧恢复码立即失效，并退出其他后台会话。</p>
        </>
      )}
      {(enroll || info?.enabled) && (
        <form onSubmit={(e) => void confirm(e)}>
          {!enroll && (
            <label>
              确认管理员密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <label>
            动态验证码
            <input
              aria-label="动态验证码"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {enroll ? "验证并启用" : "重新生成恢复码"}
          </button>
        </form>
      )}
    </section>
  );
}
