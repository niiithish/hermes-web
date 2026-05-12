/**
 * Type declarations for lib/tui-gateway-bridge.js
 */
declare module '../../lib/tui-gateway-bridge' {
  interface TuiBridge {
    proc: any;
    start(): Promise<void>;
    addClient(socket: any): void;
    removeClient(socket: any): void;
    chatStart(msg: any): Promise<{ session_id: string }>;
    chatStop(sessionId: string): void;
    respondClarify(requestId: string, text: string, choice: any): Promise<void>;
    respondApproval(approve: boolean, command: string): Promise<void>;
    respondSudo(requestId: string, password: string): Promise<void>;
    respondSecret(requestId: string, value: string): Promise<void>;
  }

  export function getBridge(profile: string): TuiBridge;
  export function killAllBridges(): void;
}
