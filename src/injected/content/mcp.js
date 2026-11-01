import * as bridge from './bridge';
import { sendCmd } from './util';
import { encodeMcpFile } from './mcp-files';

let token;
let ready;
export const setMcpToken = response => {
  ready = response::then(data => { token = data?.mcpToken; }, () => {});
};

async function authorize(data, realm) {
  await ready;
  if (!token || bridge.ids[data.id] !== realm) {
    throw new Error('MCP result channel unavailable; grant this tab and reload it');
  }
}

async function relay(cmd, data, realm) {
  await authorize(data, realm);
  return sendCmd(cmd, { ...data, token });
}

bridge.addHandlers({
  RegisterMcpHandler: (data, realm) => relay('RegisterMcpHandler', data, realm),
  ScriptResult: (data, realm) => relay('ScriptResult', data, realm),
  async McpSaveFile(data, realm) {
    await authorize(data, realm);
    const encoded = await encodeMcpFile(data);
    return relay('McpSaveFile', encoded, realm);
  },
});

bridge.addBackgroundHandlers({
  McpCall(data) {
    const realm = bridge.ids[data.id];
    if (!token || data.token !== token || realm !== PAGE && realm !== CONTENT) return false;
    bridge.post('McpCall', { id: data.id, callId: data.callId, params: data.params }, realm);
    return true;
  },
}, true);
