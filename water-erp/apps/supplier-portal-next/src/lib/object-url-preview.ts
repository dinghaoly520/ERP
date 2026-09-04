export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export function revokeObjectUrlPreview(
  currentUrl: string,
  urlApi: ObjectUrlApi = URL,
): void {
  if (currentUrl) urlApi.revokeObjectURL(currentUrl);
}

export function replaceObjectUrlPreview(
  file: Blob,
  currentUrl: string,
  urlApi: ObjectUrlApi = URL,
): string {
  const nextUrl = urlApi.createObjectURL(file);
  revokeObjectUrlPreview(currentUrl, urlApi);
  return nextUrl;
}
