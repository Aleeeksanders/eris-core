const ws = new WebSocket("ws://localhost:3000/ws");
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "message", content: "Holi", mode: "deep" }));
};
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "thinking_token" || data.type === "token") {
    process.stdout.write(data.type === "thinking_token" ? `[T]` : `[C]`);
  } else {
    console.log(`\nEvent: ${data.type}`);
  }
  if (data.type === "stream_end" || data.type === "done") process.exit(0);
};
