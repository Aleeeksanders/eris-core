const body = {
  model: "qwen3:4b",
  messages: [
    { role: "system", content: "Regla estricta: Usa <think> para pensar." },
    { role: "user", content: "holi" },
    { role: "assistant", content: "<think>\n" }
  ],
  stream: true,
  options: { temperature: 0.7 }
};

async function test() {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    full += text;
    console.log("CHUNK:", text);
  }
}
test();
