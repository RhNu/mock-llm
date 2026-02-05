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

  // 模拟 "flash"：两条固定回复，按奇偶选择
  const flashReplies = [
    "你好。",
    "我是 cognition-flash，由 cognition 提供的高速模型。",
  ];
  const parity = (text.length + messages.length) % 2;

  // 模拟 "pro"：按优先级进行正则匹配
  const rules = [
    { re: /secret|password|token/i, out: "抱歉，我无法提供该类敏感信息。" },
    { re: /time|date/i, out: "当前时间以系统时间为准。" },
    { re: /密码/, out: "抱歉，我无法提供该类敏感信息。" },
    { re: /时间/, out: "当前时间以系统时间为准。" },
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
    reasoning: `规则=${matched ? "pro" : "flash"}，${init}`,
    finish_reason: "stop",
  };
}
