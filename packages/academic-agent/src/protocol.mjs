import { StringDecoder } from "node:string_decoder";

export class JsonlDecoder {
  constructor(onRecord, maxBytes = 4 * 1024 * 1024) {
    this.onRecord = onRecord;
    this.maxBytes = maxBytes;
    this.decoder = new StringDecoder("utf8");
    this.pending = "";
  }

  push(chunk) {
    this.pending += this.decoder.write(chunk);
    let newline = this.pending.indexOf("\n");
    while (newline !== -1) {
      const line = this.pending.slice(0, newline).replace(/\r$/, "");
      this.pending = this.pending.slice(newline + 1);
      if (Buffer.byteLength(line) > this.maxBytes) throw new Error("RPC record is too large.");
      if (line) this.onRecord(JSON.parse(line));
      newline = this.pending.indexOf("\n");
    }
    if (Buffer.byteLength(this.pending) > this.maxBytes)
      throw new Error("RPC record is too large.");
  }

  end() {
    this.pending += this.decoder.end();
    if (this.pending.trim()) throw new Error("RPC stream ended with an incomplete record.");
  }
}
