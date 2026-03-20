import WebSocket from 'ws';
import process from 'process';
import readline from 'readline';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'openclaw';

const pendingMcpRequests = new Map();
let wsConnection = null;
let isConnected = false;
let messageIdCounter = 1;

// Gatewayへのリクエスト送信
function sendGatewayRequest(method, params = {}) {
  if (!isConnected || !wsConnection) {
    throw new Error('Gateway not connected');
  }
  return new Promise((resolve, reject) => {
    const id = `req_${messageIdCounter++}`;
    pendingMcpRequests.set(id, { resolve, reject });
    const req = { type: 'req', method, id, params };
    wsConnection.send(JSON.stringify(req));
    
    // タイムアウト設定 (10秒)
    setTimeout(() => {
      if (pendingMcpRequests.has(id)) {
        pendingMcpRequests.delete(id);
        reject(new Error('Gateway request timed out'));
      }
    }, 10000);
  });
}

async function connectToGateway(maxRetries = 120, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(GATEWAY_URL, {
          headers: { Origin: 'http://127.0.0.1' },
          handshakeTimeout: 5000
        });
        wsConnection = ws;

        ws.on('error', (err) => {
          if (!isConnected) reject(err);
        });

        ws.on('close', () => {
          if (isConnected) {
            isConnected = false;
          }
        });

        ws.on('message', (data) => {
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch (e) { return; }

          if (msg.type === 'event' && msg.event === 'connect.challenge') {
            const connectReq = {
              type: 'req',
              method: 'connect',
              id: `connect_${Date.now()}`,
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'openclaw-control-ui',
                  version: '1.0.0',
                  platform: 'linux',
                  mode: 'cli'
                },
                role: 'operator',
                scopes: ['operator.admin', 'operator.read', 'operator.write'],
                auth: { token: GATEWAY_TOKEN }
              }
            };
            ws.send(JSON.stringify(connectReq));
            return;
          }

          if (msg.type === 'res' && msg.id && msg.id.startsWith('connect_')) {
            if (msg.ok) {
              isConnected = true;
              resolve();
            } else {
              reject(new Error(`Failed to connect: ${msg.error?.message || JSON.stringify(msg.error)}`));
            }
            return;
          }

          if (msg.type === 'res' && pendingMcpRequests.has(msg.id)) {
            const { resolve, reject } = pendingMcpRequests.get(msg.id);
            pendingMcpRequests.delete(msg.id);
            if (msg.ok) resolve(msg.payload);
            else reject(msg.error);
          }
        });
      });
      return; // Success
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// MCP のリクエストハンドリング
async function handleMcpRequest(request) {
  const { jsonrpc, id, method, params } = request;
  if (jsonrpc !== '2.0') return;

  const respond = (result) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  };

  const respondError = (code, message) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  };

  try {
    if (method === 'initialize') {
      respond({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "OpenClaw-Gateway-MCP", version: "1.0.0" }
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return; // OK
    }

    if (method === 'tools/list') {
      if (!isConnected) {
        respond({ tools: [] });
        return;
      }
      const result = await sendGatewayRequest('mcp.listTools');
      respond(result);
      return;
    }

    if (method === 'tools/call') {
      if (!isConnected) {
        throw new Error('Gateway not connected');
      }
      const result = await sendGatewayRequest('mcp.callTool', params);
      respond({
        content: result.content || [{ type: 'text', text: JSON.stringify(result) }],
        isError: result.isError || false
      });
      return;
    }

    if (method === 'ping') {
      respond({});
      return;
    }

    respondError(-32601, `Method not found: ${method}`);
  } catch (err) {
    respondError(-32000, `Internal error: ${err.message || String(err)}`);
  }
}

async function main() {
  try {
    // Gatewayへの接続を試行。オフラインでも動作させるため失敗を無視する。
    // 起動時のブロッキングを防ぐため、リトライ回数を抑えめに設定。
    connectToGateway(5, 1000).catch(() => {});
    
    // stdioでMCPリクエストを待ち受け
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const req = JSON.parse(line);
        handleMcpRequest(req);
      } catch (e) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        }) + '\n');
      }
    });

  } catch (err) {
    process.exit(1);
  }
}

main();
