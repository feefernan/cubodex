/** O pedaço do R2 que usamos (os testes usam um balde em memória). */
export interface Bucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream | null; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
}
