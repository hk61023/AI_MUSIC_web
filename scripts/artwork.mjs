import { mkdir, writeFile } from "node:fs/promises";
const palettes = {
  violet: ["#272437", "#c3a8d0", "#776688"],
  amber: ["#403729", "#e9c691", "#9f784e"],
  aqua: ["#203a38", "#bddbc3", "#5a988a"],
  rose: ["#412734", "#ecbfcd", "#a66b85"],
  blue: ["#202c46", "#b8cdea", "#5279a1"],
  sage: ["#303c2c", "#d0dcaa", "#829461"],
};
await mkdir("public/covers", { recursive: true });
for (const [name, [bg, light, mid]] of Object.entries(palettes)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><radialGradient id="bg"><stop stop-color="${mid}"/><stop offset="1" stop-color="${bg}"/></radialGradient><radialGradient id="orb" cx=".32" cy=".2" r=".8"><stop stop-color="${light}"/><stop offset=".35" stop-color="${mid}"/><stop offset="1" stop-color="${bg}"/></radialGradient><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".1"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs><rect width="1000" height="1000" fill="url(#bg)"/><g filter="url(#grain)"><circle cx="500" cy="470" r="265" fill="url(#orb)"/><ellipse cx="500" cy="480" rx="400" ry="126" transform="rotate(-32 500 480)" fill="none" stroke="${light}" stroke-width="2" opacity=".55"/><ellipse cx="500" cy="480" rx="385" ry="120" transform="rotate(25 500 480)" fill="none" stroke="${light}" stroke-width="1" opacity=".25"/></g><path d="M800 177v58m-29-29h58" stroke="${light}" opacity=".7"/><text x="78" y="100" fill="${light}" opacity=".65" font-family="sans-serif" font-size="14" letter-spacing="7">TINGYU / SOUND STUDIES</text><text x="78" y="855" fill="${light}" font-family="Georgia,serif" font-size="76" font-style="italic">${{ violet: "Moonlit", amber: "Golden hour", aqua: "Drift away", rose: "Afterglow", blue: "Blue silence", sage: "Quiet forest" }[name]}</text><text x="82" y="911" fill="${light}" opacity=".5" font-family="sans-serif" font-size="12" letter-spacing="5">A HUMAN IDEA. AN AI ECHO.</text></svg>`;
  await writeFile(`public/covers/${name}.svg`, svg);
}
console.log("已生成 6 张本地原创抽象封面。");
