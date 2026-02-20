export class SignalingClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.handlers = new Map();
    this.queue = [];
  }

  connect() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }

    this.socket = new WebSocket(this.url);

    this.socket.addEventListener('open', () => {
      while (this.queue.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(this.queue.shift());
      }
    });

      this.socket.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          const callback = this.handlers.get(data.type);
          if (callback) {
            callback(data);
          }
        } catch {
          // Silently ignore malformed signaling payloads.
        }
      });
  }

  on(type, callback) {
    this.handlers.set(type, callback);
  }

  off(type) {
    this.handlers.delete(type);
  }

  send(type, payload = {}) {
    const message = JSON.stringify({ type, ...payload });

    if (!this.socket) {
      return;
    }

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(message);
      return;
    }

    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.queue.push(message);
    }
  }

  close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.queue = [];
    this.handlers.clear();
  }
}
