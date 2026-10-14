// A fake Worker for the chaos suite: a WebSocket server, written on raw TCP so a test can make
// it misbehave in ways a real server library won't (hang the handshake, send bytes that aren't
// frames). A Round package whose Worker URL is `url` connects to it.

import { createHash } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";

/** One accepted WebSocket, as the test sees it. */
export interface Peer {
  /** A text frame. */
  send(text: string): void;
  /** Bytes straight onto the wire, framed or not. */
  write(bytes: Buffer): void;
  /** A close frame with this code, then the TCP connection ends. */
  close(code: number): void;
}

export interface Behaviour {
  /** Leaves every handshake unanswered. */
  hang?: boolean;
  /** Called once the handshake is answered. */
  open?(peer: Peer): void;
  /** Called with each text message from the page. */
  message?(peer: Peer, text: string): void;
}

export interface FakeWorker {
  /** The Worker URL to put in a Round package. */
  url: string;
  /** Every TCP connection the page made. */
  readonly connections: number;
  /** Every handshake answered. */
  readonly handshakes: number;
  /** Every text message received, parsed where it is JSON. */
  readonly messages: unknown[];
  /** Stops listening and drops every connection, as a server going down does. */
  stop(): Promise<void>;
  /** Listens again on the same port. */
  restart(): Promise<void>;
}

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export async function startFakeWorker(behaviour: Behaviour = {}): Promise<FakeWorker> {
  const sockets = new Set<Socket>();
  const messages: unknown[] = [];
  let connections = 0;
  let handshakes = 0;
  let port = 0;
  let server: Server;

  const accept = (socket: Socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    let peer: Peer | null = null;
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!peer) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end === -1 || behaviour.hang) return;
        const key = /^sec-websocket-key:\s*(.+)$/im.exec(buffer.subarray(0, end).toString())?.[1]?.trim();
        buffer = buffer.subarray(end + 4);
        const accepted = createHash("sha1").update(key + GUID).digest("base64");
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accepted}\r\n\r\n`,
        );
        handshakes++;
        peer = peerOn(socket);
        behaviour.open?.(peer);
      }
      for (;;) {
        const frame = readFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.length);
        if (frame.opcode === 0x8) return peer.close(1000);
        if (frame.opcode !== 0x1) continue;
        const text = frame.payload.toString();
        messages.push(parse(text));
        behaviour.message?.(peer, text);
      }
    });
  };

  const listen = () =>
    new Promise<void>((resolve) => {
      server = createServer(accept);
      server.listen(port, "127.0.0.1", () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });

  await listen();
  return {
    url: `http://127.0.0.1:${port}`,
    get connections() {
      return connections;
    },
    get handshakes() {
      return handshakes;
    },
    messages,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
    restart: listen,
  };
}

function peerOn(socket: Socket): Peer {
  return {
    send: (text) => socket.write(frame(0x1, Buffer.from(text))),
    write: (bytes) => socket.write(bytes),
    close(code) {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code);
      socket.end(frame(0x8, payload));
    },
  };
}

/** A server-to-client frame: final, unmasked. */
function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const head =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : length < 65536
        ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), bigEndian64(length)]);
  return Buffer.concat([head, payload]);
}

function bigEndian64(n: number) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(n));
  return bytes;
}

/** A client-to-server frame (always masked) at the start of `buffer`, or null until it has all arrived. */
function readFrame(buffer: Buffer): { opcode: number; payload: Buffer; length: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0]! & 0x0f;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!;
  return { opcode, payload, length: offset + 4 + length };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A port nothing listens on: connecting to it is refused. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}
