import { createInterface } from "node:readline/promises";
import { setPassword } from "../server/security.mjs";
if (process.argv.includes("--password-stdin")) {
  let password = "";
  for await (const chunk of process.stdin) password += chunk;
  await setPassword(password.trim());
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const password = await rl.question(
      "设置管理员密码（至少 12 字符，仅保存安全散列）：",
    );
    const confirm = await rl.question("再次输入：");
    if (password !== confirm) throw new Error("两次密码不一致");
    await setPassword(password);
  } finally {
    rl.close();
  }
}
console.log("管理员密码已更新，旧会话已退出。");
