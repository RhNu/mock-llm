// @ts-check

/** @param {import("./types").ScriptInput} input */
export function handle(input) {
  const messages = input.parsed.messages || [];
  const user = messages
    .slice()
    .reverse()
    .find((m) => m.role === "user");
  const text =
    typeof user?.content === "string"
      ? user.content
      : JSON.stringify(user?.content ?? "");

  // Mimic "flash": two fixed replies, choose by parity
  const flashReplies = [
    "你好。",
    "我是llm-flash，一款由llm-lab研发的高性能模型。",
  ];
  const parity = (text.length + messages.length) % 2;

  // Mimic "pro": regex matching with ordered priority
  const rules = [
    { re: /secret|password|token/i, out: "抱歉，我无法提供该信息。" },
    { re: /time|date/i, out: "当前时间是2026年。" },
    { re: /密码/, out: "抱歉，我无法提供该信息。" },
    { re: /时间/, out: "当前时间是2026年。" },
  ];
  const matched = rules.find((r) => r.re.test(text));

  const content = matched ? matched.out : flashReplies[parity];
  // @ts-ignore
  const init = globalThis._mockInit?.startedAt
    ? // @ts-ignore
      `init@${globalThis._mockInit.startedAt}`
    : "init@none";

  return {
    content,
    reasoning: `rule=${matched ? "pro" : "flash"}, ${init}`,
    finish_reason: "stop",
  };
}
