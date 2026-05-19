/* eslint-disable no-console */
const { io } = require("socket.io-client");

function getArgValue(args, name) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

const args = process.argv.slice(2);

const url = getArgValue(args, "url") || "http://localhost:5000";
const conversationId =
  getArgValue(args, "conversation") || args[0];
const guestId = getArgValue(args, "guest") || args[1];
const userId = getArgValue(args, "user");

if (!conversationId) {
  console.log("Usage:");
  console.log("  node scripts/socket-listen.js <conversationId> <guestId>");
  console.log("  node scripts/socket-listen.js --conversation <id> --guest <id> [--url http://localhost:5000]");
  console.log("  node scripts/socket-listen.js --conversation <id> --user <userId> [--url http://localhost:5000]");
  process.exit(1);
}

const socket = io(url, { transports: ["websocket"] });

socket.on("connect", () => {
  console.log("connected", socket.id);
  const payload = { conversationId };
  if (guestId) payload.guestId = guestId;
  if (userId) payload.userId = userId;
  socket.emit("join_chat", payload);
});

socket.on("chat_joined", (data) => {
  console.log("chat_joined", data?.conversation?.id || "");
});

socket.on("message_stream", (data) => {
  const delta = data?.delta || "";
  if (delta) process.stdout.write(delta);
});

socket.on("message_completed", (data) => {
  const content = data?.message?.content || "";
  if (content) console.log("\nDONE:", content);
});

socket.on("message_error", (data) => {
  console.error("message_error", data);
});

socket.on("error", (err) => {
  console.error("socket error:", err);
});

socket.on("connect_error", (err) => {
  console.error("connect_error:", err?.message || err);
});

socket.on("disconnect", (reason) => {
  console.log("disconnected:", reason);
});

process.on("SIGINT", () => {
  socket.disconnect();
  process.exit(0);
});
