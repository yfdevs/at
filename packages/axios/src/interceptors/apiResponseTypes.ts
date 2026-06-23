export interface ApiResponseEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T;
  success: boolean;
  error?: string;
  timestamp: number;
}
