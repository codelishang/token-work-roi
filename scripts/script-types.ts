export interface ChildState {
  closed?: boolean;
  stdout?: string;
  stderr?: string;
}

export interface WaitOptions {
  childState?: () => ChildState;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface CdpResponse {
  id?: number;
  error?: { message?: string };
  method?: string;
  params?: {
    args?: Array<{ value?: unknown; description?: string }>;
    type?: string;
    exceptionDetails?: {
      text?: string;
      exception?: { description?: string };
    };
    entry?: { level?: string; text?: string };
  };
  result?: {
    data?: string;
    result?: { value?: Record<string, unknown> };
  };
}

export interface CdpConnection {
  send(method: string, params?: Record<string, unknown>): Promise<CdpResponse>;
  onMessage?(listener: (message: CdpResponse) => void): void;
  close(): void;
}
