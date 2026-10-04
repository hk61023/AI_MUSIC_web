export function wav(seconds = 3) {
  const rate = 22050,
    n = rate * seconds,
    buffer = Buffer.alloc(44 + n * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((i / rate) * 220 * 2 * Math.PI) * 2000),
      44 + i * 2,
    );
  return buffer;
}
export const document = {
  title: "测试月光",
  description: "安静的测试音频",
  story: "测试创作故事",
  genre: "氛围电子",
  mood: "静谧",
  vocal: "instrumental",
  source: "其他",
  generatedAt: "2026-10-04",
  tags: ["测试"],
  lyrics: "",
  prompt: "",
  featured: true,
  downloadAllowed: false,
  rightsConfirmed: false,
  rightsEvidence: "",
  licenseText: "",
};
