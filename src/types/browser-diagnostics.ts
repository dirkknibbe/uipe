export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkError {
  url: string;
  method: string;
  errorText: string;
  statusCode?: number;
  timestamp: number;
}
